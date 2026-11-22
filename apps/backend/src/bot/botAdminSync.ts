import { and, eq, inArray, ne } from "drizzle-orm";
import type { AppLanguage } from "shared";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { db } from "../db/index.js";
import { clubAdmins, clubs, users } from "../db/schema.js";
import { notifySuperadminBotIncident } from "./botIncidents.js";
import { BOT_ONBOARDING_TEXTS } from "./botTexts.js";
import type {
  TelegramChatMemberPayload,
  TelegramUserPayload,
} from "./botTypes.js";
import {
  callTelegramJson,
  isTransientTelegramApiError,
  normalizeLang,
} from "./telegramApi.js";

/**
 * Determines whether a Telegram supergroup member is authorized to configure the club bot:
 * ONLY `creator` (ChatMemberOwner) OR `administrator` with `can_manage_topics === true` (excluding bots).
 */
export function resolveClubAdminRole(
  member: TelegramChatMemberPayload | null | undefined
): "owner" | "admin" | null {
  if (!member || member.user?.is_bot) return null;
  if (member.status === "creator") return "owner";
  if (
    member.status === "administrator" &&
    member.can_manage_topics === true
  ) {
    return "admin";
  }
  return null;
}

function getBotTelegramUserId(): number | null {
  const prefix = env.TELEGRAM_BOT_TOKEN.split(":")[0]?.trim();
  if (!prefix) return null;
  const parsed = Number.parseInt(prefix, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// Short-lived cache (20s TTL) for live `getChatMember` reads; invalidated immediately on `chat_member` updates
export const LIVE_ADMIN_CACHE_TTL_MS = 20_000;
const liveAdminRoleCache = new Map<
  string,
  { role: "owner" | "admin" | null; expiresAt: number }
>();

export function setLiveAdminRoleCacheEntry(
  chatId: string,
  telegramId: string,
  role: "owner" | "admin" | null
): void {
  liveAdminRoleCache.set(`${chatId}:${telegramId}`, {
    role,
    expiresAt: Date.now() + LIVE_ADMIN_CACHE_TTL_MS,
  });
}

export function invalidateClubLiveAdminCache(
  chatId: string,
  telegramId?: string
): void {
  if (telegramId) {
    liveAdminRoleCache.delete(`${chatId}:${telegramId}`);
    return;
  }
  const prefix = `${chatId}:`;
  for (const key of liveAdminRoleCache.keys()) {
    if (key.startsWith(prefix)) {
      liveAdminRoleCache.delete(key);
    }
  }
}

export async function upsertTelegramUser(
  raw: TelegramUserPayload
): Promise<string> {
  const telegramId = String(raw.id);
  const firstName = raw.first_name?.trim() || "Admin";
  const lastName = raw.last_name?.trim() || null;
  const username = raw.username?.trim() || null;
  const langRaw = raw.language_code?.toLowerCase() || "";
  const languageCode: AppLanguage = langRaw.startsWith("en")
    ? "en"
    : langRaw.startsWith("de")
      ? "de"
      : "ru";
  const isSuperadmin = telegramId === env.SUPERADMIN_TELEGRAM_ID;

  await db
    .insert(users)
    .values({
      telegramId,
      username,
      firstName,
      lastName,
      languageCode,
      isSuperadmin,
    })
    .onConflictDoUpdate({
      target: users.telegramId,
      set: {
        username,
        firstName,
        lastName,
        isSuperadmin,
        updatedAt: new Date(),
      },
    });

  return telegramId;
}

export async function handleClubSendPermissionFailure(
  club: typeof clubs.$inferSelect,
  errorDescription: string
): Promise<void> {
  const lower = errorDescription.toLowerCase();
  const isRemoved =
    lower.includes("bot was kicked") ||
    lower.includes("bot is not a member") ||
    lower.includes("chat not found") ||
    lower.includes("chat was deactivated") ||
    lower.includes("group chat was upgraded");

  if (isRemoved) {
    await db
      .update(clubs)
      .set({ status: "bot_removed", isActive: false, updatedAt: new Date() })
      .where(and(eq(clubs.chatId, club.chatId), ne(clubs.status, "blocked")));
    await db.delete(clubAdmins).where(eq(clubAdmins.chatId, club.chatId));
    invalidateClubLiveAdminCache(club.chatId);

    await notifySuperadminBotIncident({
      kind: "bot_removed",
      chatId: club.chatId,
      clubTitle: club.title,
      clubUsername: club.username,
      detail: `Ошибка Telegram API при публикации: ${errorDescription}`,
    });
    return;
  }

  const isRightsOrTopicError =
    lower.includes("not enough rights") ||
    lower.includes("have no rights") ||
    lower.includes("chat_write_forbidden") ||
    lower.includes("topic_closed") ||
    lower.includes("topic_deleted") ||
    lower.includes("message thread not found");

  if (isRightsOrTopicError) {
    await db
      .update(clubs)
      .set({ status: "paused", isActive: false, updatedAt: new Date() })
      .where(and(eq(clubs.chatId, club.chatId), ne(clubs.status, "blocked")));

    await notifySuperadminBotIncident({
      kind: "rights_revoked",
      chatId: club.chatId,
      clubTitle: club.title,
      clubUsername: club.username,
      detail: `Ошибка доступа / темы в Telegram API: ${errorDescription}`,
    });
  }
}

/**
 * Fetches `getChatAdministrators` from Telegram and synchronizes `tele_app.club_admins`
 * so ONLY `creator` and `administrator` with `can_manage_topics === true` have settings access.
 */
export async function syncClubAdminsFromTelegram(chatId: string): Promise<{
  synced: boolean;
  creatorTelegramId: string | null;
}> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { synced: false, creatorTelegramId: null };
  }

  const res = await callTelegramJson<TelegramChatMemberPayload[]>(
    "getChatAdministrators",
    { chat_id: chatId }
  );

  if (!res.ok || !Array.isArray(res.result)) {
    if (res.description) {
      const [club] = await db
        .select()
        .from(clubs)
        .where(eq(clubs.chatId, chatId))
        .limit(1);
      if (club && club.status !== "blocked" && club.status !== "bot_removed") {
        await handleClubSendPermissionFailure(club, res.description);
      }
    }
    return { synced: false, creatorTelegramId: null };
  }

  const eligible: Array<{
    telegramId: string;
    role: "owner" | "admin";
    user: TelegramUserPayload;
  }> = [];

  for (const member of res.result) {
    const role = resolveClubAdminRole(member);
    if (!role) continue;
    const telegramId = await upsertTelegramUser(member.user);
    eligible.push({ telegramId, role, user: member.user });
  }

  const creatorEntry = eligible.find((e) => e.role === "owner") ?? null;
  if (creatorEntry) {
    await db
      .update(clubs)
      .set({
        ownerTelegramId: creatorEntry.telegramId,
        updatedAt: new Date(),
      })
      .where(eq(clubs.chatId, chatId));
  }

  const existingRows = await db
    .select({ telegramId: clubAdmins.telegramId })
    .from(clubAdmins)
    .where(eq(clubAdmins.chatId, chatId));

  const eligibleIdSet = new Set(eligible.map((e) => e.telegramId));
  const toRemove = existingRows
    .map((r) => r.telegramId)
    .filter((id) => !eligibleIdSet.has(id));

  if (toRemove.length > 0) {
    await db
      .delete(clubAdmins)
      .where(
        and(
          eq(clubAdmins.chatId, chatId),
          inArray(clubAdmins.telegramId, toRemove)
        )
      );
  }

  for (const item of eligible) {
    await db
      .insert(clubAdmins)
      .values({
        chatId,
        telegramId: item.telegramId,
        role: item.role,
      })
      .onConflictDoUpdate({
        target: [clubAdmins.chatId, clubAdmins.telegramId],
        set: { role: item.role },
      });
  }

  invalidateClubLiveAdminCache(chatId);
  for (const item of eligible) {
    setLiveAdminRoleCacheEntry(chatId, item.telegramId, item.role);
  }

  return {
    synced: true,
    creatorTelegramId: creatorEntry?.telegramId ?? null,
  };
}

/**
 * Verifies live in Telegram (`getChatMember`) whether `telegramId` currently holds
 * `creator` or `administrator` + `can_manage_topics === true` in `chatId`,
 * immediately updating `tele_app.club_admins` in PostgreSQL.
 */
export async function verifyLiveClubManager(
  chatId: string,
  telegramId: string,
  options?: { forceFresh?: boolean }
): Promise<boolean> {
  if (telegramId === env.SUPERADMIN_TELEGRAM_ID) {
    return true;
  }

  const checkLocalDbFallback = async (): Promise<boolean> => {
    const [row] = await db
      .select({ telegramId: clubAdmins.telegramId })
      .from(clubAdmins)
      .where(
        and(
          eq(clubAdmins.chatId, chatId),
          eq(clubAdmins.telegramId, telegramId)
        )
      )
      .limit(1);
    return Boolean(row);
  };

  if (!env.TELEGRAM_BOT_TOKEN) {
    return checkLocalDbFallback();
  }

  const cacheKey = `${chatId}:${telegramId}`;
  if (!options?.forceFresh) {
    const cached = liveAdminRoleCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.role !== null;
    }
  }

  const numericUserId = Number(telegramId);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    return false;
  }

  try {
    const res = await callTelegramJson<TelegramChatMemberPayload>(
      "getChatMember",
      {
        chat_id: chatId,
        user_id: numericUserId,
      },
      {
        timeoutMs: 4_000,
        maxAttempts: 1,
      }
    );

    if (isTransientTelegramApiError(res)) {
      throw new Error(
        res.description ??
          `Telegram transient HTTP ${res.error_code ?? "5xx"}`
      );
    }

    if (!res.ok || !res.result) {
      setLiveAdminRoleCacheEntry(chatId, telegramId, null);
      await db
        .delete(clubAdmins)
        .where(
          and(
            eq(clubAdmins.chatId, chatId),
            eq(clubAdmins.telegramId, telegramId)
          )
        );
      return false;
    }

    const role = resolveClubAdminRole(res.result);
    setLiveAdminRoleCacheEntry(chatId, telegramId, role);

    if (role) {
      await upsertTelegramUser(res.result.user);
      await db
        .insert(clubAdmins)
        .values({ chatId, telegramId, role })
        .onConflictDoUpdate({
          target: [clubAdmins.chatId, clubAdmins.telegramId],
          set: { role },
        });
      if (role === "owner") {
        await db
          .update(clubs)
          .set({ ownerTelegramId: telegramId, updatedAt: new Date() })
          .where(eq(clubs.chatId, chatId));
      }
      return true;
    }

    await db
      .delete(clubAdmins)
      .where(
        and(
          eq(clubAdmins.chatId, chatId),
          eq(clubAdmins.telegramId, telegramId)
        )
      );
    return false;
  } catch (err) {
    logger.warn(
      {
        event: "telegram_admin_check_error",
        chatId,
        telegramId,
        error: err instanceof Error ? err.message : String(err),
      },
      "verifyLiveClubManager transient error"
    );
    return checkLocalDbFallback();
  }
}

/**
 * Verifies that @ExtraPawnTeleBot itself still holds administrator status
 * with `can_manage_topics` and `can_delete_messages` in `chatId`.
 */
export async function verifyBotHasClubPermissions(
  chatId: string,
  rawLang?: string | null
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { ok: true };
  }
  const botUserId = getBotTelegramUserId();
  if (!botUserId) {
    return { ok: true };
  }

  const lang = normalizeLang(rawLang);
  const texts = BOT_ONBOARDING_TEXTS[lang];

  try {
    const res = await callTelegramJson<TelegramChatMemberPayload>(
      "getChatMember",
      {
        chat_id: chatId,
        user_id: botUserId,
      }
    );

    if (!res.ok || !res.result) {
      return {
        ok: false,
        reason: texts.botNotInGroup,
      };
    }

    const m = res.result;
    if (m.status !== "administrator") {
      return {
        ok: false,
        reason: texts.botNotAdmin,
      };
    }

    const missing: string[] = [];
    if (!m.can_manage_topics) {
      missing.push(texts.permManageTopics);
    }
    if (!m.can_delete_messages) {
      missing.push(texts.permDeleteMessages);
    }

    if (missing.length > 0) {
      return {
        ok: false,
        reason: texts.botMissingPerms(missing.join(", ")),
      };
    }

    return { ok: true };
  } catch {
    // Do not block on transient network hiccup to Telegram
    return { ok: true };
  }
}
