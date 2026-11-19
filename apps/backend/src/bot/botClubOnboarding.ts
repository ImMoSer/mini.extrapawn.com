import { and, eq, ne } from "drizzle-orm";
import {
  createDefaultWeeklySchedule,
  MAX_OWNED_CLUBS_PER_USER,
  type AppLanguage,
} from "shared";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { clubAdmins, clubs } from "../db/schema.js";
import { invalidateClubMembershipCache } from "../services/clubMembership.service.js";
import {
  invalidateClubLiveAdminCache,
  resolveClubAdminRole,
  setLiveAdminRoleCacheEntry,
  syncClubAdminsFromTelegram,
  upsertTelegramUser,
} from "./botAdminSync.js";
import { clearAutoPause } from "./botAutoPause.js";
import { publishChallengeToClub } from "./botChallengePublisher.js";
import {
  consumeBotInitiatedLeave,
  leaveClubChat,
  notifySuperadminBotIncident,
  sendBlockedClubNoticeAndLeave,
} from "./botIncidents.js";
import { BOT_ONBOARDING_TEXTS, resolveOnboardingLanguage } from "./botTexts.js";
import type { TelegramChatMemberPayload, TelegramUpdate } from "./botTypes.js";
import { sendPendingClubApplicationNotices } from "./clubModeration.js";
import { callTelegramJson, normalizeLang } from "./telegramApi.js";

async function upsertClubRecord(params: {
  chatId: string;
  title: string;
  username: string | null;
  existingInviteLink: string | null;
  ownerTelegramId: string;
  topicThreadId: number;
  memberCount: number;
  language: AppLanguage;
  status: "pending" | "active" | "paused";
  isActive: boolean;
}): Promise<void> {
  const inviteLink = params.username
    ? `https://t.me/${params.username}/${params.topicThreadId}`
    : null;

  await db
    .insert(clubs)
    .values({
      chatId: params.chatId,
      title: params.title,
      username: params.username,
      inviteLink,
      ownerTelegramId: params.ownerTelegramId,
      topicThreadId: params.topicThreadId,
      memberCount: params.memberCount,
      language: params.language,
      status: params.status,
      isActive: params.isActive,
      autoPaused: false,
      autoPauseChallengeId: null,
      autoPauseMessageId: null,
      weeklySchedule: createDefaultWeeklySchedule(),
    })
    .onConflictDoUpdate({
      target: clubs.chatId,
      set: {
        title: params.title,
        username: params.username,
        inviteLink: inviteLink ?? params.existingInviteLink,
        ownerTelegramId: params.ownerTelegramId,
        topicThreadId: params.topicThreadId,
        memberCount: params.memberCount,
        language: params.language,
        status: params.status,
        isActive: params.isActive,
        updatedAt: new Date(),
      },
    });
}

/**
 * Handles real-time `chat_member` updates in connected supergroups when any member
 * is promoted, demoted, has `can_manage_topics` toggled, or leaves/is kicked.
 */
export async function handleChatMemberUpdate(
  update: NonNullable<TelegramUpdate["chat_member"]>
): Promise<void> {
  if (update.chat.type !== "supergroup") return;
  const targetUser = update.new_chat_member?.user;
  if (!targetUser || targetUser.is_bot) return;

  const chatId = String(update.chat.id);
  const targetTelegramId = String(targetUser.id);
  invalidateClubLiveAdminCache(chatId, targetTelegramId);
  invalidateClubMembershipCache(chatId, targetTelegramId);

  const [club] = await db
    .select({
      chatId: clubs.chatId,
      status: clubs.status,
      ownerTelegramId: clubs.ownerTelegramId,
    })
    .from(clubs)
    .where(eq(clubs.chatId, chatId))
    .limit(1);

  if (!club || club.status === "blocked" || club.status === "bot_removed") {
    return;
  }

  const role = resolveClubAdminRole(update.new_chat_member);
  setLiveAdminRoleCacheEntry(chatId, targetTelegramId, role);

  if (role) {
    await upsertTelegramUser(targetUser);
    await db
      .insert(clubAdmins)
      .values({
        chatId,
        telegramId: targetTelegramId,
        role,
      })
      .onConflictDoUpdate({
        target: [clubAdmins.chatId, clubAdmins.telegramId],
        set: { role },
      });

    if (role === "owner" && club.ownerTelegramId !== targetTelegramId) {
      await db
        .update(clubs)
        .set({ ownerTelegramId: targetTelegramId, updatedAt: new Date() })
        .where(eq(clubs.chatId, chatId));
    }
    return;
  }

  await db
    .delete(clubAdmins)
    .where(
      and(
        eq(clubAdmins.chatId, chatId),
        eq(clubAdmins.telegramId, targetTelegramId)
      )
    );
}

/**
 * Handles `my_chat_member` updates when @ExtraPawnTeleBot is added, removed/kicked,
 * or has its administrator privileges modified in a group.
 */
export async function handleMyChatMemberUpdate(
  update: NonNullable<TelegramUpdate["my_chat_member"]>
): Promise<void> {
  const chatId = String(update.chat.id);
  const status = update.new_chat_member.status;

  const [existingClub] = await db
    .select()
    .from(clubs)
    .where(eq(clubs.chatId, chatId))
    .limit(1);

  // 1. Bot removed or kicked from chat
  if (status === "left" || status === "kicked") {
    const wasIntentionalLeave = consumeBotInitiatedLeave(chatId);
    invalidateClubLiveAdminCache(chatId);
    invalidateClubMembershipCache(chatId);

    if (existingClub && existingClub.status !== "blocked") {
      await db
        .update(clubs)
        .set({
          status: "bot_removed",
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(clubs.chatId, chatId));

      await db.delete(clubAdmins).where(eq(clubAdmins.chatId, chatId));

      if (!wasIntentionalLeave) {
        await notifySuperadminBotIncident({
          kind: "bot_removed",
          chatId,
          clubTitle: update.chat.title || existingClub.title,
          clubUsername: update.chat.username ?? existingClub.username,
          detail:
            status === "kicked"
              ? "Бот заблокирован / исключён из супергруппы (status: kicked)"
              : "Бот удалён из супергруппы (status: left)",
          actor: update.from,
        });
      }
    }
    return;
  }

  const fromId = String(update.from.id);
  const isSuperadminActor = fromId === env.SUPERADMIN_TELEGRAM_ID;
  const isOnboardingOrReconnect =
    !existingClub ||
    existingClub.status === "bot_removed" ||
    !existingClub.topicThreadId;

  const { language: clubLang, explicitChoice } =
    await resolveOnboardingLanguage({
      actorTelegramId: fromId,
      rawTgLangCode: update.from.language_code,
      existingClubLang: existingClub?.language,
      isOnboardingOrReconnect,
    });
  const texts = BOT_ONBOARDING_TEXTS[clubLang];

  // 2. Blocked club blacklist check
  if (existingClub?.status === "blocked") {
    await sendBlockedClubNoticeAndLeave(
      chatId,
      existingClub.topicThreadId,
      existingClub.language || clubLang
    );
    return;
  }

  // 3. Must be a supergroup
  if (update.chat.type !== "supergroup") {
    await leaveClubChat(chatId, texts.notSupergroup);
    return;
  }

  // 4. Verify bot's own administrator permissions (`can_manage_topics` & `can_delete_messages`)
  const isAdminStatus = status === "administrator";
  const hasManageTopics = Boolean(update.new_chat_member.can_manage_topics);
  const hasDeleteMessages = Boolean(update.new_chat_member.can_delete_messages);
  const botHasRequiredRights =
    isAdminStatus && hasManageTopics && hasDeleteMessages;

  if (!botHasRequiredRights) {
    if (!existingClub) {
      await leaveClubChat(chatId, texts.missingBotRights);
      return;
    }

    const missingDescriptions: string[] = [];
    if (!isAdminStatus) {
      missingDescriptions.push(
        `Сняты права администратора у бота (текущий статус: ${status})`
      );
    } else {
      if (!hasManageTopics) {
        missingDescriptions.push(
          "Отключено право «Управление темами» (can_manage_topics)"
        );
      }
      if (!hasDeleteMessages) {
        missingDescriptions.push(
          "Отключено право «Удаление сообщений» (can_delete_messages)"
        );
      }
    }

    await db
      .update(clubs)
      .set({
        status: "paused",
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(clubs.chatId, chatId));

    await notifySuperadminBotIncident({
      kind: "rights_revoked",
      chatId,
      clubTitle: update.chat.title || existingClub.title,
      clubUsername: update.chat.username ?? existingClub.username,
      detail: missingDescriptions.join("; "),
      actor: update.from,
    });
    return;
  }

  // 5. Fetch member count
  const countRes = await callTelegramJson<number>("getChatMemberCount", {
    chat_id: chatId,
  });
  const memberCount = countRes.result ?? existingClub?.memberCount ?? 0;

  if (isOnboardingOrReconnect) {
    if (!isSuperadminActor && memberCount < 30) {
      await leaveClubChat(chatId, texts.belowMinMembers(memberCount));
      return;
    }

    // 6. Inviter must be `creator` or `administrator` with `can_manage_topics === true` (or SuperAdmin)
    const memberInfoRes = await callTelegramJson<TelegramChatMemberPayload>(
      "getChatMember",
      {
        chat_id: chatId,
        user_id: update.from.id,
      }
    );
    const inviterRole = resolveClubAdminRole(memberInfoRes.result);
    if (!isSuperadminActor && !inviterRole) {
      await leaveClubChat(chatId, texts.inviterNotAllowed);
      return;
    }
  }

  // 7. Inspect chat administrators to identify real `creator` (if non-bot) before checking club limit
  const adminsRes = await callTelegramJson<TelegramChatMemberPayload[]>(
    "getChatAdministrators",
    { chat_id: chatId }
  );
  const creatorMember = Array.isArray(adminsRes.result)
    ? adminsRes.result.find((m) => m.status === "creator" && !m.user?.is_bot)
    : undefined;

  await upsertTelegramUser(update.from);
  if (creatorMember) {
    await upsertTelegramUser(creatorMember.user);
  }

  const effectiveOwnerId = creatorMember
    ? String(creatorMember.user.id)
    : existingClub?.ownerTelegramId || fromId;

  // 7.5 Enforce max 2 owned clubs per non-superadmin owner on onboarding / reconnect
  if (
    isOnboardingOrReconnect &&
    !isSuperadminActor &&
    effectiveOwnerId !== env.SUPERADMIN_TELEGRAM_ID
  ) {
    const ownedClubs = await db
      .select({ chatId: clubs.chatId })
      .from(clubs)
      .where(
        and(
          eq(clubs.ownerTelegramId, effectiveOwnerId),
          ne(clubs.status, "bot_removed"),
          ne(clubs.chatId, chatId)
        )
      );
    if (ownedClubs.length >= MAX_OWNED_CLUBS_PER_USER) {
      await leaveClubChat(
        chatId,
        texts.clubLimitReached(MAX_OWNED_CLUBS_PER_USER)
      );
      return;
    }
  }

  // 8. Ensure Forum Topic "ExtraPawnTeleBot" exists
  let topicThreadId = existingClub?.topicThreadId || 0;

  const createBotForumTopic = async (): Promise<number | null> => {
    const topicRes = await callTelegramJson<{ message_thread_id: number }>(
      "createForumTopic",
      {
        chat_id: chatId,
        name: "ExtraPawnTeleBot",
      }
    );
    if (!topicRes.ok || !topicRes.result?.message_thread_id) {
      return null;
    }
    return topicRes.result.message_thread_id;
  };

  if (!topicThreadId) {
    const createdThreadId = await createBotForumTopic();
    if (!createdThreadId) {
      if (!existingClub) {
        await leaveClubChat(chatId, texts.topicsDisabled);
      }
      return;
    }
    topicThreadId = createdThreadId;
  }

  // 9. Determine whether SuperAdmin moderation is required before activating the club
  const persistedLanguage = normalizeLang(
    explicitChoice ?? existingClub?.language ?? clubLang
  );
  const resolvedClubTitle =
    update.chat.title || existingClub?.title || "Chess Club";
  const requiresModeration =
    !isSuperadminActor &&
    chatId !== "-1002255301933" &&
    (!existingClub ||
      existingClub.status === "pending" ||
      existingClub.status === "bot_removed");

  if (requiresModeration) {
    await upsertClubRecord({
      chatId,
      title: resolvedClubTitle,
      username: update.chat.username || null,
      existingInviteLink: existingClub?.inviteLink ?? null,
      ownerTelegramId: effectiveOwnerId,
      topicThreadId,
      memberCount,
      language: persistedLanguage,
      status: "pending",
      isActive: false,
    });

    await clearAutoPause(chatId);
    await syncClubAdminsFromTelegram(chatId);

    if (!existingClub || existingClub.status !== "pending") {
      await sendPendingClubApplicationNotices({
        chatId,
        topicThreadId,
        title: resolvedClubTitle,
        username: update.chat.username || null,
        memberCount,
        language: persistedLanguage,
        ownerTelegramId: effectiveOwnerId,
        inviter: update.from,
      });
    }
    return;
  }

  // 10. Auto-approved onboarding (SuperAdmin / default club) or permission refresh on an already approved club
  let welcomeSent = false;
  if (isOnboardingOrReconnect) {
    const welcomeText = texts.welcomeTopic;
    const welcomeRes = await callTelegramJson("sendMessage", {
      chat_id: chatId,
      message_thread_id: topicThreadId,
      parse_mode: "HTML",
      text: welcomeText,
    });

    if (
      !welcomeRes.ok &&
      welcomeRes.description &&
      (welcomeRes.description.toLowerCase().includes("message thread not found") ||
        welcomeRes.description.toLowerCase().includes("topic_deleted"))
    ) {
      const recreatedThreadId = await createBotForumTopic();
      if (recreatedThreadId) {
        topicThreadId = recreatedThreadId;
        const retryWelcome = await callTelegramJson("sendMessage", {
          chat_id: chatId,
          message_thread_id: topicThreadId,
          parse_mode: "HTML",
          text: welcomeText,
        });
        welcomeSent = retryWelcome.ok;
      }
    } else {
      welcomeSent = welcomeRes.ok;
    }
  }

  const preservedStatus =
    existingClub && existingClub.status === "paused" && !isOnboardingOrReconnect
      ? "paused"
      : "active";
  const preservedActive =
    existingClub && existingClub.status === "paused" && !isOnboardingOrReconnect
      ? false
      : true;

  await upsertClubRecord({
    chatId,
    title: resolvedClubTitle,
    username: update.chat.username || null,
    existingInviteLink: existingClub?.inviteLink ?? null,
    ownerTelegramId: effectiveOwnerId,
    topicThreadId,
    memberCount,
    language: persistedLanguage,
    status: preservedStatus,
    isActive: preservedActive,
  });

  await clearAutoPause(chatId);
  await syncClubAdminsFromTelegram(chatId);

  if (isOnboardingOrReconnect && welcomeSent) {
    try {
      await publishChallengeToClub(chatId);
    } catch (err) {
      console.error(
        `[TelegramBot] Initial challenge publish failed for ${chatId}:`,
        err
      );
    }
  }
}
