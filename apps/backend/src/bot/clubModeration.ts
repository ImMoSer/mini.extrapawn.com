import { eq } from "drizzle-orm";
import type { AppLanguage } from "shared";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { db } from "../db/index.js";
import { clubAdmins, clubs } from "../db/schema.js";
import {
  appendClubTopicMessageId,
  callTelegramJson,
  escapeHtml,
  normalizeLang,
} from "./telegramApi.js";

export interface ModerationTelegramActor {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramCallbackQueryPayload {
  id: string;
  from: ModerationTelegramActor;
  data?: string;
  message?: {
    message_id: number;
    chat: {
      id: number;
    };
    text?: string;
  };
}

export interface ClubModerationBotHooks {
  verifyBotHasClubPermissions: (
    chatId: string,
    rawLang?: string | null
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  publishChallengeToClub: (chatId: string) => Promise<unknown>;
  leaveClubChat: (chatId: string, reasonMessage?: string) => Promise<void>;
  clearAutoPause: (chatId: string) => Promise<void>;
}

const MODERATION_TEXTS: Record<
  AppLanguage,
  {
    pendingTopicNotice: string;
    approvedWelcome: string;
    rejectedLeaveNotice: string;
  }
> = {
  ru: {
    pendingTopicNotice:
      "⏳ <b>Заявка на подключение клуба отправлена!</b>\nКлуб успешно прошёл техническую проверку и ожидает подтверждения администратором ExtraPawn.\nКак только заявка будет одобрена, челленджи запустятся в этой теме автоматически.",
    approvedWelcome:
      "♟ <b>Заявка одобрена! ExtraPawn Challenge Bot активирован.</b>\nВсе шахматные челленджи и таблицы рекордов клуба будут публиковаться в этой теме.\nНастроить расписание, язык, дисциплины и сложность могут владелец группы и администраторы с правом «Управление темами» в Mini App.",
    rejectedLeaveNotice:
      "ℹ️ Заявка на подключение клуба к ExtraPawn отклонена модератором. Бот покидает супергруппу.",
  },
  en: {
    pendingTopicNotice:
      "⏳ <b>Club connection request submitted!</b>\nYour supergroup passed technical verification and is awaiting approval by the ExtraPawn administrator.\nOnce approved, chess challenges will start in this topic automatically.",
    approvedWelcome:
      "♟ <b>Application approved! ExtraPawn Challenge Bot is active.</b>\nAll chess challenges and club leaderboards will be published in this topic.\nThe group owner and administrators with the 'Manage Topics' permission can configure the schedule, language, disciplines, and difficulty in the Mini App.",
    rejectedLeaveNotice:
      "ℹ️ The club connection request to ExtraPawn was declined by the moderator. The bot is leaving the supergroup.",
  },
  de: {
    pendingTopicNotice:
      "⏳ <b>Antrag auf Klub-Verbindung gesendet!</b>\nIhre Supergruppe hat die technische Prüfung bestanden und wartet auf die Freigabe durch den ExtraPawn-Administrator.\nSobald der Antrag genehmigt wurde, starten die Challenges in diesem Thema automatisch.",
    approvedWelcome:
      "♟ <b>Antrag genehmigt! ExtraPawn Challenge Bot ist aktiviert.</b>\nAlle Schach-Challenges und Klub-Ranglisten werden in diesem Thema veröffentlicht.\nDer Gruppeneigentümer und Administratoren mit dem Recht „Themen verwalten“ können Zeitplan, Sprache, Disziplinen und Schwierigkeit in der Mini App einstellen.",
    rejectedLeaveNotice:
      "ℹ️ Der Antrag auf Verbindung des Klubs mit ExtraPawn wurde vom Moderator abgelehnt. Der Bot verlässt die Supergruppe.",
  },
};

/**
 * Sends a club application notice to the club's topic thread and immediately sends an
 * interactive approval card with [ ✅ Одобрить | 🚫 Отклонить ] buttons to SuperAdmin's DM.
 */
export async function sendPendingClubApplicationNotices(params: {
  chatId: string;
  topicThreadId: number;
  title: string;
  username: string | null;
  memberCount: number;
  language: AppLanguage;
  ownerTelegramId: string;
  inviter: ModerationTelegramActor;
}): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;

  const lang = normalizeLang(params.language);
  const texts = MODERATION_TEXTS[lang];

  let effectiveThreadId = params.topicThreadId;
  let topicRes = await callTelegramJson<{ message_id: number }>("sendMessage", {
    chat_id: params.chatId,
    message_thread_id: effectiveThreadId,
    parse_mode: "HTML",
    text: texts.pendingTopicNotice,
  });

  if (
    !topicRes.ok &&
    topicRes.description &&
    (topicRes.description.toLowerCase().includes("message thread not found") ||
      topicRes.description.toLowerCase().includes("topic_deleted"))
  ) {
    const recreated = await callTelegramJson<{ message_thread_id: number }>(
      "createForumTopic",
      {
        chat_id: params.chatId,
        name: "ExtraPawnTeleBot",
      }
    );
    if (recreated.ok && recreated.result?.message_thread_id) {
      effectiveThreadId = recreated.result.message_thread_id;
      await db
        .update(clubs)
        .set({ topicThreadId: effectiveThreadId, updatedAt: new Date() })
        .where(eq(clubs.chatId, params.chatId));
      topicRes = await callTelegramJson<{ message_id: number }>("sendMessage", {
        chat_id: params.chatId,
        message_thread_id: effectiveThreadId,
        parse_mode: "HTML",
        text: texts.pendingTopicNotice,
      });
    }
  }
  await appendClubTopicMessageId(params.chatId, topicRes.result?.message_id);

  if (!env.SUPERADMIN_TELEGRAM_ID) return;

  const safeTitle = escapeHtml(params.title || `Club ${params.chatId}`);
  const handlePart = params.username
    ? ` (<a href="https://t.me/${escapeHtml(params.username)}">@${escapeHtml(params.username)}</a>)`
    : " (приватная супергруппа)";
  const inviterName = escapeHtml(
    [params.inviter.first_name, params.inviter.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() || "Admin"
  );
  const inviterHandle = params.inviter.username
    ? `@${escapeHtml(params.inviter.username)}, `
    : "";

  const dmText = [
    "🆕 <b>Новая заявка на подключение клуба!</b>",
    "",
    `🏛 <b>Клуб:</b> ${safeTitle}${handlePart}`,
    `🆔 <b>chat_id:</b> <code>${escapeHtml(params.chatId)}</code>`,
    `👥 <b>Участников:</b> ${params.memberCount}`,
    `🌐 <b>Язык:</b> ${lang.toUpperCase()}`,
    `👑 <b>Owner ID:</b> <code>${escapeHtml(params.ownerTelegramId)}</code>`,
    `👤 <b>Кто добавил:</b> ${inviterName} (${inviterHandle}ID: <code>${params.inviter.id}</code>)`,
    "",
    "Подтвердить подключение клуба к чемпионату ExtraPawn?",
  ].join("\n");

  await callTelegramJson("sendMessage", {
    chat_id: env.SUPERADMIN_TELEGRAM_ID,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    text: dmText,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "✅ Одобрить",
            callback_data: `mod_approve:${params.chatId}`,
          },
          {
            text: "🚫 Отклонить",
            callback_data: `mod_reject:${params.chatId}`,
          },
        ],
        [
          {
            text: "🛡 Открыть панель BOSS",
            url: `https://t.me/${env.BOT_USERNAME}?startapp=superadmin`,
          },
        ],
      ],
    },
  });
}

/**
 * Approves a pending club (`status -> 'active'`, `is_active -> true`), sends the welcome message,
 * and publishes the initial chess challenge into the club's topic.
 */
export async function approvePendingClub(
  chatId: string,
  hooks: ClubModerationBotHooks
): Promise<{
  ok: true;
  club: typeof clubs.$inferSelect;
} | {
  ok: false;
  error: string;
}> {
  const [row] = await db
    .select()
    .from(clubs)
    .where(eq(clubs.chatId, chatId))
    .limit(1);

  if (!row) {
    return { ok: false, error: "Клуб не найден в базе данных." };
  }

  const rights = await hooks.verifyBotHasClubPermissions(chatId, row.language);
  if (!rights.ok) {
    return { ok: false, error: rights.reason };
  }

  const [updated] = await db
    .update(clubs)
    .set({
      status: "active",
      isActive: true,
      blockedReason: null,
      updatedAt: new Date(),
    })
    .where(eq(clubs.chatId, chatId))
    .returning();

  const activeClub = updated ?? row;
  await hooks.clearAutoPause(chatId);

  const lang = normalizeLang(activeClub.language);
  const welcomePayload: Record<string, unknown> = {
    chat_id: chatId,
    parse_mode: "HTML",
    text: MODERATION_TEXTS[lang].approvedWelcome,
  };
  if (activeClub.topicThreadId > 0) {
    welcomePayload.message_thread_id = activeClub.topicThreadId;
  }
  await callTelegramJson("sendMessage", welcomePayload);

  try {
    await hooks.publishChallengeToClub(chatId);
  } catch (err) {
    logger.error(
      {
        event: "approval_publish_error",
        chatId,
        error: err instanceof Error ? err.message : String(err),
      },
      "Initial challenge publish after approval failed"
    );
  }

  logger.info(
    { event: "club_approved", chatId, title: activeClub.title },
    "Club approved"
  );
  return { ok: true, club: activeClub };
}

/**
 * Rejects a pending club application: sends a polite notice, leaves the supergroup,
 * and deletes the pending club record from PostgreSQL.
 */
export async function rejectPendingClub(
  chatId: string,
  hooks: ClubModerationBotHooks
): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .select()
    .from(clubs)
    .where(eq(clubs.chatId, chatId))
    .limit(1);

  if (!row) {
    return { ok: false, error: "Заявка клуба уже удалена или не найдена." };
  }

  const lang = normalizeLang(row.language);
  const rejectText = MODERATION_TEXTS[lang].rejectedLeaveNotice;

  if (env.TELEGRAM_BOT_TOKEN && row.topicThreadId > 0) {
    await callTelegramJson("sendMessage", {
      chat_id: chatId,
      message_thread_id: row.topicThreadId,
      text: rejectText,
    });
    await hooks.leaveClubChat(chatId);
  } else {
    await hooks.leaveClubChat(chatId, rejectText);
  }

  await db.delete(clubAdmins).where(eq(clubAdmins.chatId, chatId));
  await db.delete(clubs).where(eq(clubs.chatId, chatId));

  logger.info(
    { event: "club_rejected", chatId, title: row.title },
    "Club application rejected"
  );
  return { ok: true };
}

/**
 * Handles inline `[ ✅ Одобрить | 🚫 Отклонить ]` button clicks from SuperAdmin's Telegram DM.
 */
export async function handleSuperadminModerationCallback(
  query: TelegramCallbackQueryPayload,
  hooks: ClubModerationBotHooks
): Promise<void> {
  const data = query.data ?? "";
  if (!data.startsWith("mod_approve:") && !data.startsWith("mod_reject:")) {
    return;
  }

  if (String(query.from.id) !== env.SUPERADMIN_TELEGRAM_ID) {
    await callTelegramJson("answerCallbackQuery", {
      callback_query_id: query.id,
      text: "⛔ Только SuperAdmin может модерировать заявки.",
      show_alert: true,
    });
    return;
  }

  const isApprove = data.startsWith("mod_approve:");
  const chatId = data.slice(data.indexOf(":") + 1).trim();

  if (!chatId) {
    await callTelegramJson("answerCallbackQuery", {
      callback_query_id: query.id,
      text: "Некорректный chat_id",
      show_alert: true,
    });
    return;
  }

  if (isApprove) {
    const res = await approvePendingClub(chatId, hooks);
    await callTelegramJson("answerCallbackQuery", {
      callback_query_id: query.id,
      text: res.ok
        ? "✅ Клуб одобрен и первый челлендж опубликован!"
        : `⚠️ ${res.error}`,
      show_alert: !res.ok,
    });

    if (res.ok && query.message) {
      const baseText = escapeHtml(query.message.text ?? "");
      await callTelegramJson("editMessageText", {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: "HTML",
        text: `${baseText}\n\n✅ <b>СТАТУС: ОДОБРЕНО</b>`,
      });
    }
    return;
  }

  const res = await rejectPendingClub(chatId, hooks);
  await callTelegramJson("answerCallbackQuery", {
    callback_query_id: query.id,
    text: res.ok
      ? "🚫 Заявка отклонена, бот вышел из группы."
      : `⚠️ ${res.error ?? "Ошибка"}`,
    show_alert: !res.ok,
  });

  if (res.ok && query.message) {
    const baseText = escapeHtml(query.message.text ?? "");
    await callTelegramJson("editMessageText", {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: "HTML",
      text: `${baseText}\n\n🚫 <b>СТАТУС: ОТКЛОНЕНО</b>`,
    });
  }
}
