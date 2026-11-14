import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  ne,
  or,
} from "drizzle-orm";
import {
  ALL_DAYS_OF_WEEK,
  calculateAttemptPoints,
  createDefaultWeeklySchedule,
  encodeChallengeStartParam,
  encodeClubLeaderboardStartParam,
  formatFocusLabel,
  MAX_OWNED_CLUBS_PER_USER,
  normalizeWeeklySchedule,
  roundPoints,
  type AppLanguage,
  type ChallengeDifficulty,
  type ChallengeDiscipline,
  type ClubScheduleSlot,
  type DayOfWeekKey,
} from "shared";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import {
  challengeAttempts,
  clubAdmins,
  clubChallenges,
  clubs,
  users,
} from "../db/schema.js";
import { renderBoardPng } from "../services/boardImage.service.js";
import {
  type NormalizedChallengePuzzle,
  puzzleClientService,
} from "../services/puzzleClient.service.js";

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface TelegramUserPayload {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChatMemberPayload {
  status: string;
  user: TelegramUserPayload;
  is_anonymous?: boolean;
  can_manage_chat?: boolean;
  can_delete_messages?: boolean;
  can_manage_topics?: boolean;
}

interface TelegramChatPayload {
  id: number;
  type: string;
  title?: string;
  username?: string;
  is_forum?: boolean;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: TelegramUserPayload;
    chat: TelegramChatPayload;
    text?: string;
  };
  my_chat_member?: {
    chat: TelegramChatPayload;
    from: TelegramUserPayload;
    old_chat_member?: TelegramChatMemberPayload;
    new_chat_member: TelegramChatMemberPayload;
  };
  chat_member?: {
    chat: TelegramChatPayload;
    from: TelegramUserPayload;
    old_chat_member: TelegramChatMemberPayload;
    new_chat_member: TelegramChatMemberPayload;
  };
}

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

// Tracks intentional bot leaves (validation failure, SuperAdmin block/purge) so we don't send false incident DMs
const botInitiatedLeaves = new Map<string, number>();

function markBotInitiatedLeave(chatId: string): void {
  botInitiatedLeaves.set(chatId, Date.now() + 30_000);
}

function consumeBotInitiatedLeave(chatId: string): boolean {
  const expiresAt = botInitiatedLeaves.get(chatId);
  if (!expiresAt) return false;
  botInitiatedLeaves.delete(chatId);
  return Date.now() <= expiresAt;
}

// Short-lived cache (20s TTL) for live `getChatMember` reads; invalidated immediately on `chat_member` updates
const LIVE_ADMIN_CACHE_TTL_MS = 20_000;
const liveAdminRoleCache = new Map<
  string,
  { role: "owner" | "admin" | null; expiresAt: number }
>();

function invalidateClubLiveAdminCache(chatId: string, telegramId?: string): void {
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

// Deduplicates identical SuperAdmin incident DMs within 60 seconds
const recentSuperadminAlerts = new Map<string, number>();

// Stores explicit club language selected by an admin via the mandatory EN/DE/RU checkboxes in Mini App before adding the bot
const PENDING_ONBOARDING_LANG_TTL_MS = 2 * 60 * 60 * 1000;
const pendingOnboardingLanguages = new Map<
  string,
  { language: AppLanguage; expiresAt: number }
>();

function setPendingOnboardingLanguageInternal(
  telegramId: string,
  language: AppLanguage
): void {
  pendingOnboardingLanguages.set(telegramId, {
    language: normalizeLang(language),
    expiresAt: Date.now() + PENDING_ONBOARDING_LANG_TTL_MS,
  });
}

function getPendingOnboardingLanguageInternal(
  telegramId: string
): AppLanguage | null {
  const entry = pendingOnboardingLanguages.get(telegramId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pendingOnboardingLanguages.delete(telegramId);
    return null;
  }
  return entry.language;
}

function resolveLangFromTelegramCode(
  rawCode?: string | null
): AppLanguage {
  if (!rawCode) return "en";
  const lower = rawCode.trim().toLowerCase();
  if (lower.startsWith("de")) return "de";
  if (lower.startsWith("ru")) return "ru";
  return "en";
}

async function resolveUserLanguage(
  telegramId: string,
  rawTgLangCode?: string | null
): Promise<AppLanguage> {
  try {
    const [u] = await db
      .select({ languageCode: users.languageCode })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);
    if (u?.languageCode) {
      return normalizeLang(u.languageCode);
    }
  } catch {
    // Fallback to Telegram client language_code below
  }
  return resolveLangFromTelegramCode(rawTgLangCode);
}

async function resolveOnboardingLanguage(params: {
  actorTelegramId: string;
  rawTgLangCode?: string | null;
  existingClubLang?: string | null;
  isOnboardingOrReconnect: boolean;
}): Promise<{ language: AppLanguage; explicitChoice: AppLanguage | null }> {
  const explicitChoice = getPendingOnboardingLanguageInternal(
    params.actorTelegramId
  );

  if (explicitChoice && params.isOnboardingOrReconnect) {
    return { language: explicitChoice, explicitChoice };
  }
  if (params.existingClubLang) {
    return {
      language: normalizeLang(params.existingClubLang),
      explicitChoice,
    };
  }
  if (explicitChoice) {
    return { language: explicitChoice, explicitChoice };
  }
  const fallback = await resolveUserLanguage(
    params.actorTelegramId,
    params.rawTgLangCode
  );
  return { language: fallback, explicitChoice: null };
}

const BOT_ONBOARDING_TEXTS = {
  ru: {
    notSupergroup:
      "⚠️ Для работы @ExtraPawnTeleBot необходима Супергруппа с включёнными Темами (Topics) и минимум 30 участниками.",
    missingBotRights:
      "⚠️ Пожалуйста, выдайте @ExtraPawnTeleBot права администратора «Управление темами» (Manage Topics) и «Удаление сообщений» (Delete Messages) в супергруппе с включёнными Темами, затем добавьте бота снова.",
    belowMinMembers: (count: number) =>
      `⚠️ Для подключения @ExtraPawnTeleBot в супергруппе должно быть минимум 30 участников (сейчас: ${count}). Добавьте бота повторно, когда клуб вырастет!`,
    inviterNotAllowed:
      "⚠️ Подключить @ExtraPawnTeleBot может только владелец супергруппы или администратор с правом «Управление темами» (Manage Topics).",
    clubLimitReached: (max: number) =>
      `⚠️ Достигнут лимит: к одному аккаунту владельца можно подключить не более ${max} шахматных клубов в ExtraPawn.`,
    topicsDisabled:
      "⚠️ Пожалуйста, включите «Темы» (Topics) в настройках вашей супергруппы и выдайте @ExtraPawnTeleBot право «Управление темами» (Manage Topics), затем добавьте бота снова.",
    welcomeTopic:
      "♟ <b>ExtraPawn Challenge Bot подключён!</b>\nВсе шахматные челленджи и таблицы рекордов клуба будут публиковаться в этой теме.\nНастроить расписание, язык, дисциплины и сложность могут владелец группы и администраторы с правом «Управление темами» в Mini App.",
    privateStartText:
      "♟ <b>Добро пожаловать в ExtraPawn Challenges!</b>\nРешайте шахматные челленджи в клубах или подключите бота к своей супергруппе.",
    privateStartBtn: "🚀 Открыть Mini App",
    botNotInGroup:
      "Бот @ExtraPawnTeleBot отсутствует в супергруппе или не имеет доступа к чату.",
    botNotAdmin:
      "У бота @ExtraPawnTeleBot сняты права администратора в супергруппе. Выдайте боту права администратора в настройках группы Telegram.",
    permManageTopics: "«Управление темами» (Manage Topics)",
    permDeleteMessages: "«Удаление сообщений» (Delete Messages)",
    botMissingPerms: (list: string) =>
      `У бота @ExtraPawnTeleBot в супергруппе отключены обязательные права: ${list}. Включите их в настройках группы Telegram.`,
  },
  en: {
    notSupergroup:
      "⚠️ @ExtraPawnTeleBot requires a Supergroup with Topics enabled and at least 30 members.",
    missingBotRights:
      "⚠️ Please grant @ExtraPawnTeleBot the administrator permissions 'Manage Topics' and 'Delete Messages' in a Supergroup with Topics enabled, then add the bot again.",
    belowMinMembers: (count: number) =>
      `⚠️ Your supergroup must have at least 30 members to connect @ExtraPawnTeleBot (currently: ${count}). Please add the bot again once your club grows!`,
    inviterNotAllowed:
      "⚠️ Only the supergroup owner or an administrator with the 'Manage Topics' permission can connect @ExtraPawnTeleBot.",
    clubLimitReached: (max: number) =>
      `⚠️ Limit reached: up to ${max} chess clubs can be connected per owner account in ExtraPawn.`,
    topicsDisabled:
      "⚠️ Please enable 'Topics' in your supergroup settings and grant @ExtraPawnTeleBot the 'Manage Topics' permission, then add the bot again.",
    welcomeTopic:
      "♟ <b>ExtraPawn Challenge Bot is connected!</b>\nAll chess challenges and club leaderboards will be published in this topic.\nThe group owner and administrators with the 'Manage Topics' permission can configure the schedule, language, disciplines, and difficulty in the Mini App.",
    privateStartText:
      "♟ <b>Welcome to ExtraPawn Challenges!</b>\nSolve chess challenges in clubs or connect the bot to your own supergroup.",
    privateStartBtn: "🚀 Open Mini App",
    botNotInGroup:
      "@ExtraPawnTeleBot is not in the supergroup or does not have access to the chat.",
    botNotAdmin:
      "@ExtraPawnTeleBot is no longer an administrator in the supergroup. Please restore administrator permissions in your Telegram group settings.",
    permManageTopics: "'Manage Topics'",
    permDeleteMessages: "'Delete Messages'",
    botMissingPerms: (list: string) =>
      `@ExtraPawnTeleBot is missing required permissions in the supergroup: ${list}. Please enable them in your Telegram group settings.`,
  },
  de: {
    notSupergroup:
      "⚠️ Für @ExtraPawnTeleBot wird eine Supergruppe mit aktivierten Themen (Topics) und mindestens 30 Mitgliedern benötigt.",
    missingBotRights:
      "⚠️ Bitte erteilen Sie @ExtraPawnTeleBot die Administratorrechte „Themen verwalten“ (Manage Topics) und „Nachrichten löschen“ (Delete Messages) in einer Supergruppe mit aktivierten Themen und fügen Sie den Bot anschließend erneut hinzu.",
    belowMinMembers: (count: number) =>
      `⚠️ Für die Verbindung von @ExtraPawnTeleBot muss Ihre Supergruppe mindestens 30 Mitglieder haben (aktuell: ${count}). Bitte fügen Sie den Bot erneut hinzu, sobald Ihr Klub gewachsen ist!`,
    inviterNotAllowed:
      "⚠️ Nur der Eigentümer der Supergruppe oder ein Administrator mit dem Recht „Themen verwalten“ (Manage Topics) kann @ExtraPawnTeleBot verbinden.",
    clubLimitReached: (max: number) =>
      `⚠️ Limit erreicht: Pro Eigentümer-Account können maximal ${max} Schachklubs in ExtraPawn verbunden werden.`,
    topicsDisabled:
      "⚠️ Bitte aktivieren Sie „Themen“ (Topics) in den Einstellungen Ihrer Supergruppe und erteilen Sie @ExtraPawnTeleBot das Recht „Themen verwalten“ (Manage Topics). Fügen Sie den Bot danach erneut hinzu.",
    welcomeTopic:
      "♟ <b>ExtraPawn Challenge Bot ist verbunden!</b>\nAlle Schach-Challenges und Klub-Ranglisten werden in diesem Thema veröffentlicht.\nDer Gruppeneigentümer und Administratoren mit dem Recht „Themen verwalten“ können Zeitplan, Sprache, Disziplinen und Schwierigkeit in der Mini App einstellen.",
    privateStartText:
      "♟ <b>Willkommen bei ExtraPawn Challenges!</b>\nLösen Sie Schach-Challenges in Klubs oder verbinden Sie den Bot mit Ihrer eigenen Supergruppe.",
    privateStartBtn: "🚀 Mini App öffnen",
    botNotInGroup:
      "@ExtraPawnTeleBot ist nicht in der Supergruppe oder hat keinen Zugriff auf den Chat.",
    botNotAdmin:
      "@ExtraPawnTeleBot hat keine Administratorrechte mehr in der Supergruppe. Bitte erteilen Sie dem Bot in den Telegram-Gruppeneinstellungen wieder Administratorrechte.",
    permManageTopics: "„Themen verwalten“ (Manage Topics)",
    permDeleteMessages: "„Nachrichten löschen“ (Delete Messages)",
    botMissingPerms: (list: string) =>
      `Bei @ExtraPawnTeleBot fehlen erforderliche Rechte in der Supergruppe: ${list}. Bitte aktivieren Sie diese in den Telegram-Gruppeneinstellungen.`,
  },
} as const;

const DISCIPLINE_LABELS: Record<
  AppLanguage,
  Record<ChallengeDiscipline, string>
> = {
  ru: {
    tactics: "Тактика",
    theoretical_endgames: "Теоретический эндшпиль",
    practical_chess: "Практический эндшпиль",
    finishhim: "Добивание (Finish Him)",
  },
  en: {
    tactics: "Tactics",
    theoretical_endgames: "Theoretical Endgame",
    practical_chess: "Practical Endgame",
    finishhim: "Finish Him",
  },
  de: {
    tactics: "Taktik",
    theoretical_endgames: "Endspieltheorie",
    practical_chess: "Praktisches Endspiel",
    finishhim: "Finish Him",
  },
};

const PLAIN_DIFFICULTY_LABELS: Record<
  AppLanguage,
  Record<ChallengeDifficulty, string>
> = {
  ru: {
    Novice: "Новичок",
    Pro: "Профи",
    Master: "Мастер",
  },
  en: {
    Novice: "Novice",
    Pro: "Pro",
    Master: "Master",
  },
  de: {
    Novice: "Einsteiger",
    Pro: "Profi",
    Master: "Meister",
  },
};

function normalizeLang(raw: string | null | undefined): AppLanguage {
  if (raw === "en" || raw === "de") return raw;
  return "ru";
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildChallengeCaption(
  puzzle: NormalizedChallengePuzzle,
  rawLang: AppLanguage
): string {
  const lang = normalizeLang(rawLang);
  const discLabel = DISCIPLINE_LABELS[lang][puzzle.discipline];
  const plainDiffLabel = PLAIN_DIFFICULTY_LABELS[lang][puzzle.difficulty];

  const diffLabel =
    puzzle.discipline === "tactics"
      ? plainDiffLabel
      : `${plainDiffLabel} (MOZERO)`;

  const categoryLabel = formatFocusLabel(
    puzzle.discipline,
    puzzle.category,
    lang
  );

  let goalLabel =
    lang === "en"
      ? "Find the best continuation"
      : lang === "de"
        ? "Beste Fortsetzung finden"
        : "Найти лучшее продолжение";

  if (puzzle.discipline !== "tactics") {
    if (puzzle.objective === "hold_draw") {
      goalLabel =
        lang === "en"
          ? "Hold a draw against the bot"
          : lang === "de"
            ? "Remis gegen den Bot halten"
            : "Удержать ничью против бота";
    } else {
      goalLabel =
        lang === "en"
          ? "Win against the bot"
          : lang === "de"
            ? "Gegen den Bot gewinnen"
            : "Победить бота";
    }
  } else if (puzzle.category.toLowerCase().includes("mate")) {
    goalLabel =
      lang === "en"
        ? "Deliver checkmate"
        : lang === "de"
          ? "Matt setzen"
          : "Поставить мат";
  }

  const turnLabel =
    puzzle.userColor === "white"
      ? lang === "en"
        ? "White to move ⚪"
        : lang === "de"
          ? "Weiß am Zug ⚪"
          : "Белых ⚪"
      : lang === "en"
        ? "Black to move ⚫"
        : lang === "de"
          ? "Schwarz am Zug ⚫"
          : "Черных ⚫";

  if (lang === "en") {
    return [
      `♟ <b>Discipline:</b> ${discLabel}`,
      `⚙️ <b>Difficulty:</b> ${diffLabel}`,
      `🎯 <b>Category:</b> ${categoryLabel}`,
      `⚔️ <b>Goal:</b> ${goalLabel}`,
      `⏳ <b>Turn:</b> ${turnLabel}`,
    ].join("\n");
  }

  if (lang === "de") {
    return [
      `♟ <b>Disziplin:</b> ${discLabel}`,
      `⚙️ <b>Stufe:</b> ${diffLabel}`,
      `🎯 <b>Fokus:</b> ${categoryLabel}`,
      `⚔️ <b>Ziel:</b> ${goalLabel}`,
      `⏳ <b>Am Zug:</b> ${turnLabel}`,
    ].join("\n");
  }

  return [
    `♟ <b>Дисциплина:</b> ${discLabel}`,
    `⚙️ <b>Сложность:</b> ${diffLabel}`,
    `🎯 <b>Категория:</b> ${categoryLabel}`,
    `⚔️ <b>Задача:</b> ${goalLabel}`,
    `⏳ <b>Ход:</b> ${turnLabel}`,
  ].join("\n");
}

async function callTelegramJson<T>(
  method: string,
  payload: Record<string, unknown>
): Promise<TelegramApiResponse<T>> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, description: "TELEGRAM_BOT_TOKEN not set" };
  }
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const isLongPoll = method === "getUpdates";
  const maxAttempts = isLongPoll ? 1 : 3;
  const timeoutMs = isLongPoll ? 25_000 : 15_000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Connection: "close",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return (await res.json()) as TelegramApiResponse<T>;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        console.warn(
          `[TelegramBot] ${method} network error (attempt ${attempt}/${maxAttempts}), retrying...`,
          err instanceof Error ? err.message : err
        );
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }
  throw lastError;
}

async function deleteTelegramMessage(
  chatId: string,
  messageId: number
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !messageId) return;
  try {
    await callTelegramJson("deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  } catch (err) {
    console.warn(
      `[TelegramBot] deleteMessage failed for chat ${chatId} (message ${messageId}):`,
      err instanceof Error ? err.message : err
    );
  }
}

async function upsertTelegramUser(raw: TelegramUserPayload): Promise<string> {
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

async function notifySuperadminBotIncident(params: {
  kind: "bot_removed" | "rights_revoked";
  chatId: string;
  clubTitle: string;
  clubUsername?: string | null;
  detail: string;
  actor?: TelegramUserPayload;
}): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.SUPERADMIN_TELEGRAM_ID) return;

  const dedupKey = `${params.chatId}:${params.kind}:${params.detail}`;
  const nowMs = Date.now();
  const prevAt = recentSuperadminAlerts.get(dedupKey);
  if (prevAt && nowMs - prevAt < 60_000) {
    return;
  }
  recentSuperadminAlerts.set(dedupKey, nowMs);

  const safeTitle = escapeHtml(params.clubTitle || `Club ${params.chatId}`);
  const clubHandle = params.clubUsername
    ? ` (@${escapeHtml(params.clubUsername)})`
    : "";
  const safeDetail = escapeHtml(params.detail);

  let actorLine = "";
  if (params.actor) {
    const actorName = escapeHtml(
      [params.actor.first_name, params.actor.last_name]
        .filter(Boolean)
        .join(" ")
        .trim() || "User"
    );
    const actorHandle = params.actor.username
      ? `@${escapeHtml(params.actor.username)}, `
      : "";
    actorLine = `\n👤 <b>Кто выполнил:</b> ${actorName} (${actorHandle}ID: <code>${params.actor.id}</code>)`;
  }

  const header =
    params.kind === "bot_removed"
      ? `🚨 <b>Бота удалили / кикнули из клуба!</b>`
      : `⚠️ <b>Бота лишили прав в клубе!</b>`;

  const statusNote =
    params.kind === "bot_removed"
      ? `⏸ Клуб переведён в статус <b>BOT REMOVED</b> (публикации остановлены, данные сохранены в БД). Вы можете полностью удалить данные клуба или заблокировать его в панели BOSS.`
      : `⏸ Клуб автоматически поставлен на паузу (<b>PAUSED</b>), данные сохранены в БД. Вы можете связаться с клубом, заблокировать его или полностью удалить данные в панели BOSS.`;

  const text = [
    header,
    ``,
    `🏛 <b>Клуб:</b> ${safeTitle}${clubHandle}`,
    `🆔 <b>chat_id:</b> <code>${escapeHtml(params.chatId)}</code>`,
    `📌 <b>Детали:</b> ${safeDetail}${actorLine}`,
    ``,
    statusNote,
  ].join("\n");

  try {
    await callTelegramJson("sendMessage", {
      chat_id: env.SUPERADMIN_TELEGRAM_ID,
      parse_mode: "HTML",
      text,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🛡 Открыть панель BOSS",
              url: `https://t.me/${env.BOT_USERNAME}?startapp=superadmin`,
            },
          ],
        ],
      },
    });
  } catch (err) {
    console.warn(
      "[TelegramBot] Failed to send incident DM to SuperAdmin:",
      err instanceof Error ? err.message : err
    );
  }
}

async function handleClubSendPermissionFailure(
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

async function sendTelegramPhoto(params: {
  chatId: string;
  messageThreadId?: number;
  pngBuffer: Buffer;
  caption: string;
  replyMarkup?: Record<string, unknown>;
  onApiError?: (description: string) => void;
}): Promise<number | null> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return null;
  }

  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const form = new FormData();
      form.append("chat_id", params.chatId);
      if (params.messageThreadId && params.messageThreadId > 0) {
        form.append("message_thread_id", String(params.messageThreadId));
      }
      form.append("parse_mode", "HTML");
      form.append("caption", params.caption);
      if (params.replyMarkup) {
        form.append("reply_markup", JSON.stringify(params.replyMarkup));
      }
      const blob = new Blob([new Uint8Array(params.pngBuffer)], {
        type: "image/png",
      });
      form.append("photo", blob, "board.png");

      const res = await fetch(url, {
        method: "POST",
        headers: { Connection: "close" },
        body: form,
        signal: AbortSignal.timeout(25_000),
      });
      const data = (await res.json()) as TelegramApiResponse<{
        message_id: number;
      }>;
      if (!data.ok) {
        console.error(
          `[TelegramBot] sendPhoto API error for chat ${params.chatId} (thread ${params.messageThreadId ?? 0}):`,
          data.description
        );
        if (data.description && params.onApiError) {
          params.onApiError(data.description);
        }
        return null;
      }
      return data.result?.message_id ?? null;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        console.warn(
          `[TelegramBot] sendPhoto network error for chat ${params.chatId} (attempt ${attempt}/${maxAttempts}), retrying...`,
          err instanceof Error ? err.message : err
        );
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }

  throw lastError;
}

export const telegramBotService = {
  /**
   * Selects a fresh puzzle for the club, renders board.png, posts to the club's topic thread,
   * and saves the challenge record in `tele_app.club_challenges`.
   */
  async publishChallengeToClub(
    chatId: string,
    override?: {
      discipline?: ChallengeDiscipline;
      difficulty?: ChallengeDifficulty;
      focusGroup?: string;
      focusKey?: string;
      objective?: string;
      puzzleId?: string;
    }
  ) {
    const [club] = await db
      .select()
      .from(clubs)
      .where(eq(clubs.chatId, chatId))
      .limit(1);

    if (!club) {
      throw new Error(`[TelegramBot] Club ${chatId} not found`);
    }
    if (club.status === "blocked") {
      throw new Error(`[TelegramBot] Club ${chatId} is blocked`);
    }

    // Resolve slot from weeklySchedule when override is not explicitly passed,
    // so discipline + difficulty + focus_group + focus_key + objective always stay synchronized.
    const schedule = normalizeWeeklySchedule(club.weeklySchedule);
    const zoned = getClubZonedTime(new Date(), club.timezone);
    const todaySlots = schedule[zoned.day]?.enabled
      ? schedule[zoned.day].slots
      : [];
    const activeHourSlot = todaySlots.find(
      (s) => zoned.hour >= s.from_hour && zoned.hour < s.to_hour
    );
    const allEnabledSlots: ClubScheduleSlot[] = [];
    for (const day of ALL_DAYS_OF_WEEK) {
      if (schedule[day].enabled) {
        allEnabledSlots.push(...schedule[day].slots);
      }
    }
    const fallbackSlot =
      activeHourSlot ??
      todaySlots[0] ??
      (allEnabledSlots.length > 0
        ? allEnabledSlots[Math.floor(Math.random() * allEnabledSlots.length)]
        : undefined);

    const chosenDiscipline: ChallengeDiscipline =
      override?.discipline ?? fallbackSlot?.discipline ?? "tactics";

    const chosenDifficulty: ChallengeDifficulty =
      override?.difficulty ?? fallbackSlot?.difficulty ?? "Novice";

    const chosenFocusGroup =
      override?.focusGroup ?? fallbackSlot?.focus_group ?? "all";
    const chosenFocusKey =
      override?.focusKey ?? fallbackSlot?.focus_key ?? "all";
    const chosenObjective =
      override?.objective ?? fallbackSlot?.objective ?? "all";

    // Get already published puzzle IDs in this club for this discipline
    const previousRows = await db
      .select({ puzzleId: clubChallenges.puzzleId })
      .from(clubChallenges)
      .where(
        and(
          eq(clubChallenges.chatId, chatId),
          eq(clubChallenges.discipline, chosenDiscipline)
        )
      );
    const excludeIds = previousRows.map((r) => r.puzzleId);

    const puzzle = override?.puzzleId
      ? await puzzleClientService.getPuzzleById(
          chosenDiscipline,
          override.puzzleId
        )
      : await puzzleClientService.selectClubPuzzle({
          discipline: chosenDiscipline,
          difficulty: chosenDifficulty,
          focusGroup: chosenFocusGroup,
          focusKey: chosenFocusKey,
          objective: chosenObjective,
          excludeIds,
        });

    const edition = String(previousRows.length + 1);
    const pngBuffer = renderBoardPng({
      fen: puzzle.puzzleFen,
      orientation: puzzle.userColor,
      lastMoveUci: puzzle.lastMoveUci,
    });

    const lang = normalizeLang(club.language);
    const caption = buildChallengeCaption(puzzle, lang);
    const solveStartParam = encodeChallengeStartParam(
      puzzle.discipline,
      puzzle.puzzleId,
      edition,
      chatId
    );
    const recordsStartParam = encodeClubLeaderboardStartParam(chatId);

    const solveBtnText =
      lang === "en"
        ? "🔥 SOLVE"
        : lang === "de"
          ? "🔥 LÖSEN"
          : "🔥 ЗАТАЩИТЬ";
    const tableBtnText =
      lang === "en"
        ? "🏆 TABLE"
        : lang === "de"
          ? "🏆 TABELLE"
          : "🏆 ТАБЛИЦА";

    let apiErrorDescription: string | undefined;
    const tgMessageId = await sendTelegramPhoto({
      chatId,
      messageThreadId: club.topicThreadId,
      pngBuffer,
      caption,
      onApiError: (desc) => {
        apiErrorDescription = desc;
      },
      replyMarkup: {
        inline_keyboard: [
          [
            {
              text: solveBtnText,
              url: `https://t.me/${env.BOT_USERNAME}?startapp=${solveStartParam}`,
            },
            {
              text: tableBtnText,
              url: `https://t.me/${env.BOT_USERNAME}?startapp=${recordsStartParam}`,
            },
          ],
        ],
      },
    });

    if (!tgMessageId && env.TELEGRAM_BOT_TOKEN) {
      if (apiErrorDescription) {
        await handleClubSendPermissionFailure(club, apiErrorDescription);
      }
      throw new Error(
        `[TelegramBot] sendPhoto returned no message_id for chat ${chatId} (thread ${club.topicThreadId})${apiErrorDescription ? `: ${apiErrorDescription}` : ""}`
      );
    }

    // Auto-clean previous challenge message(s) so only the active challenge stays in the topic
    const previousActiveMessages = await db
      .select({
        id: clubChallenges.id,
        tgMessageId: clubChallenges.tgMessageId,
      })
      .from(clubChallenges)
      .where(
        and(
          eq(clubChallenges.chatId, chatId),
          isNotNull(clubChallenges.tgMessageId)
        )
      );

    for (const prev of previousActiveMessages) {
      if (prev.tgMessageId && prev.tgMessageId !== tgMessageId) {
        await deleteTelegramMessage(chatId, prev.tgMessageId);
      }
    }

    if (previousActiveMessages.length > 0) {
      await db
        .update(clubChallenges)
        .set({ tgMessageId: null })
        .where(
          and(
            eq(clubChallenges.chatId, chatId),
            isNotNull(clubChallenges.tgMessageId)
          )
        );
    }

    const [inserted] = await db
      .insert(clubChallenges)
      .values({
        chatId,
        discipline: puzzle.discipline,
        puzzleId: puzzle.puzzleId,
        edition,
        difficulty: puzzle.difficulty,
        botEngine: puzzle.botEngine,
        initialFen: puzzle.initialFen,
        puzzleFen: puzzle.puzzleFen,
        userColor: puzzle.userColor,
        firstMove: puzzle.firstMove,
        strategy: puzzle.strategy,
        objective: puzzle.objective,
        tacticalSolution: puzzle.tacticalSolution,
        domain: puzzle.domain,
        category: puzzle.category,
        tgMessageId,
      })
      .onConflictDoUpdate({
        target: [
          clubChallenges.chatId,
          clubChallenges.discipline,
          clubChallenges.puzzleId,
          clubChallenges.edition,
        ],
        set: {
          tgMessageId,
          publishedAt: new Date(),
        },
      })
      .returning();

    await db
      .update(clubs)
      .set({
        lastPublishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(clubs.chatId, chatId));

    await this.clearAutoPause(chatId);

    return inserted;
  },

  /**
   * Sends the reply notification to the club's topic thread when a player solves a challenge:
   * "{{username}} 🤝\nПопыток - {{attempts}}\nСекунд - {{seconds}}" + inline button ТАБЛИЦА
   */
  async notifyChallengeSolved(params: {
    chatId: string;
    discipline: ChallengeDiscipline;
    puzzleId: string;
    edition: string;
    username: string;
    attempts: number;
    timeMs: number;
  }): Promise<void> {
    if (!env.TELEGRAM_BOT_TOKEN) return;

    const [club] = await db
      .select()
      .from(clubs)
      .where(eq(clubs.chatId, params.chatId))
      .limit(1);

    if (!club || club.status === "blocked") return;

    const [challenge] = await db
      .select()
      .from(clubChallenges)
      .where(
        and(
          eq(clubChallenges.chatId, params.chatId),
          eq(clubChallenges.discipline, params.discipline),
          eq(clubChallenges.puzzleId, params.puzzleId),
          eq(clubChallenges.edition, params.edition)
        )
      )
      .orderBy(desc(clubChallenges.publishedAt))
      .limit(1);

    const seconds = Math.round((params.timeMs / 1000) * 10) / 10;
    const lang = normalizeLang(club.language);
    const text =
      lang === "en"
        ? `${params.username} 🤝\nAttempts - ${params.attempts}\nSeconds - ${seconds}`
        : lang === "de"
          ? `${params.username} 🤝\nVersuche - ${params.attempts}\nSekunden - ${seconds}`
          : `${params.username} 🤝\nПопыток - ${params.attempts}\nСекунд - ${seconds}`;

    const recordsStartParam = encodeClubLeaderboardStartParam(params.chatId);
    const tableBtnText =
      lang === "en"
        ? "🏆 TABLE"
        : lang === "de"
          ? "🏆 TABELLE"
          : "🏆 ТАБЛИЦА";

    const payload: Record<string, unknown> = {
      chat_id: params.chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: tableBtnText,
              url: `https://t.me/${env.BOT_USERNAME}?startapp=${recordsStartParam}`,
            },
          ],
        ],
      },
    };

    if (club.topicThreadId > 0) {
      payload.message_thread_id = club.topicThreadId;
    }
    if (challenge?.tgMessageId) {
      payload.reply_parameters = {
        message_id: challenge.tgMessageId,
        allow_sending_without_reply: true,
      };
    }

    const sendRes = await callTelegramJson<{ message_id: number }>(
      "sendMessage",
      payload
    );
    const solvedMessageId = sendRes.result?.message_id;
    if (solvedMessageId) {
      setTimeout(() => {
        void deleteTelegramMessage(params.chatId, solvedMessageId);
      }, 30_000);
    }
  },

  /**
   * Sends a concise notification to the club's topic thread when an admin saves club settings.
   */
  async notifyClubSettingsUpdated(params: {
    chatId: string;
    firstName: string;
  }): Promise<void> {
    if (!env.TELEGRAM_BOT_TOKEN) return;

    const [club] = await db
      .select()
      .from(clubs)
      .where(eq(clubs.chatId, params.chatId))
      .limit(1);

    if (!club || club.status === "blocked") return;

    const lang = normalizeLang(club.language);
    const safeName = escapeHtml(params.firstName.trim() || "Admin");
    const text =
      lang === "en"
        ? `⚙️ <b>${safeName}</b> updated the settings.`
        : lang === "de"
          ? `⚙️ <b>${safeName}</b> hat die Einstellungen geändert.`
          : `⚙️ <b>${safeName}</b> изменил настройки.`;

    const payload: Record<string, unknown> = {
      chat_id: params.chatId,
      parse_mode: "HTML",
      text,
    };

    if (club.topicThreadId > 0) {
      payload.message_thread_id = club.topicThreadId;
    }

    await callTelegramJson("sendMessage", payload);
  },

  /**
   * Publishes a periodic Top-10 Club Standings summary to the club's topic thread
   * and updates `clubs.lastLeaderboardAt`.
   */
  async publishClubLeaderboardToTopic(chatId: string): Promise<boolean> {
    if (!env.TELEGRAM_BOT_TOKEN) return false;

    const [club] = await db
      .select()
      .from(clubs)
      .where(eq(clubs.chatId, chatId))
      .limit(1);

    if (!club || club.status !== "active") return false;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        attempt: challengeAttempts,
        user: users,
      })
      .from(challengeAttempts)
      .leftJoin(users, eq(challengeAttempts.telegramId, users.telegramId))
      .where(
        and(
          eq(challengeAttempts.chatId, chatId),
          gte(challengeAttempts.updatedAt, sevenDaysAgo)
        )
      );

    const statsByUser = new Map<
      string,
      {
        displayName: string;
        points: number;
        solved: number;
        attempts: number;
        timeMs: number;
      }
    >();

    for (const r of rows) {
      const att = r.attempt;
      if (!att.solved) continue;
      const usr = r.user;
      const displayName = escapeHtml(usr?.firstName || att.username);

      let entry = statsByUser.get(att.telegramId);
      if (!entry) {
        entry = {
          displayName,
          points: 0,
          solved: 0,
          attempts: 0,
          timeMs: 0,
        };
        statsByUser.set(att.telegramId, entry);
      }

      entry.points += calculateAttemptPoints(att.solved, att.attempts);
      entry.solved += 1;
      entry.attempts += att.attempts;
      entry.timeMs += Number(att.solvedTimeMs ?? 0);
    }

    const sorted = Array.from(statsByUser.values()).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
      return a.attempts - b.attempts;
    });

    if (sorted.length === 0) {
      await db
        .update(clubs)
        .set({ lastLeaderboardAt: new Date(), updatedAt: new Date() })
        .where(eq(clubs.chatId, chatId));
      return false;
    }

    const top10 = sorted.slice(0, 10);
    const lang = normalizeLang(club.language);
    const lines = top10.map((item, idx) => {
      const medal =
        idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}.`;
      const pts = roundPoints(item.points);
      const sec = Math.round((item.timeMs / 1000) * 10) / 10;
      if (lang === "en") {
        return `${medal} <b>${item.displayName}</b> — <b>${pts} pts</b> (${item.solved} solved, ${sec}s)`;
      }
      if (lang === "de") {
        return `${medal} <b>${item.displayName}</b> — <b>${pts} Pkt.</b> (${item.solved} gelöst, ${sec}s)`;
      }
      return `${medal} <b>${item.displayName}</b> — <b>${pts} очк.</b> (решено: ${item.solved}, ${sec}с)`;
    });

    const text =
      lang === "en"
        ? `🏆 <b>${club.title} — Top Players</b>\n\n${lines.join("\n")}`
        : lang === "de"
          ? `🏆 <b>${club.title} — Top-Spieler</b>\n\n${lines.join("\n")}`
          : `🏆 <b>${club.title} — Лидеры клуба</b>\n\n${lines.join("\n")}`;

    const recordsStartParam = encodeClubLeaderboardStartParam(chatId);
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      parse_mode: "HTML",
      text,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                lang === "en"
                  ? "🏆 FULL LEADERBOARD"
                  : lang === "de"
                    ? "🏆 GESAMTE RANGLISTE"
                    : "🏆 ВСЯ ТАБЛИЦА",
              url: `https://t.me/${env.BOT_USERNAME}?startapp=${recordsStartParam}`,
            },
          ],
        ],
      },
    };
    if (club.topicThreadId > 0) {
      payload.message_thread_id = club.topicThreadId;
    }

    const res = await callTelegramJson("sendMessage", payload);
    await db
      .update(clubs)
      .set({ lastLeaderboardAt: new Date(), updatedAt: new Date() })
      .where(eq(clubs.chatId, chatId));

    return res.ok;
  },

  /**
   * Forces the bot to leave a chat (used when SuperAdmin blocks a club or when onboarding validation fails).
   */
  async leaveClubChat(chatId: string, reasonMessage?: string): Promise<void> {
    if (!env.TELEGRAM_BOT_TOKEN) return;
    markBotInitiatedLeave(chatId);
    if (reasonMessage) {
      await callTelegramJson("sendMessage", {
        chat_id: chatId,
        text: reasonMessage,
      });
    }
    await callTelegramJson("leaveChat", { chat_id: chatId });
  },

  /**
   * Sends the localized blocked-club notice with the @ProfessorMozer QR code and link, then leaves the chat.
   */
  async sendBlockedClubNoticeAndLeave(
    chatId: string,
    topicThreadId?: number,
    rawLang?: string | null
  ): Promise<void> {
    if (!env.TELEGRAM_BOT_TOKEN) return;

    const lang = normalizeLang(rawLang);
    const caption =
      lang === "en"
        ? `⛔ <b>Your club is temporarily blocked.</b>\nPlease contact the developer: <a href="https://t.me/ProfessorMozer">@ProfessorMozer</a>`
        : lang === "de"
          ? `⛔ <b>Ihr Klub ist vorübergehend gesperrt.</b>\nBitte wenden Sie sich an den Entwickler: <a href="https://t.me/ProfessorMozer">@ProfessorMozer</a>`
          : `⛔ <b>Ваш клуб временно заблокирован.</b>\nОбратитесь к разработчику: <a href="https://t.me/ProfessorMozer">@ProfessorMozer</a>`;

    const replyMarkup = {
      inline_keyboard: [
        [
          {
            text: "💬 @ProfessorMozer",
            url: "https://t.me/ProfessorMozer",
          },
        ],
      ],
    };

    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const qrAssetPath = path.resolve(
      currentDir,
      "../../assets/professor_mozer_qr.png"
    );
    let sentPhotoId: number | null = null;

    if (fs.existsSync(qrAssetPath)) {
      const qrBuffer = fs.readFileSync(qrAssetPath);
      if (topicThreadId && topicThreadId > 0) {
        sentPhotoId = await sendTelegramPhoto({
          chatId,
          messageThreadId: topicThreadId,
          pngBuffer: qrBuffer,
          caption,
          replyMarkup,
        });
      }
      if (!sentPhotoId) {
        sentPhotoId = await sendTelegramPhoto({
          chatId,
          pngBuffer: qrBuffer,
          caption,
          replyMarkup,
        });
      }
    }

    if (!sentPhotoId) {
      const msgPayload: Record<string, unknown> = {
        chat_id: chatId,
        parse_mode: "HTML",
        text: caption,
        reply_markup: replyMarkup,
      };
      if (topicThreadId && topicThreadId > 0) {
        msgPayload.message_thread_id = topicThreadId;
      }
      const msgRes = await callTelegramJson("sendMessage", msgPayload);
      if (!msgRes.ok && topicThreadId && topicThreadId > 0) {
        delete msgPayload.message_thread_id;
        await callTelegramJson("sendMessage", msgPayload);
      }
    }

    markBotInitiatedLeave(chatId);
    await callTelegramJson("leaveChat", { chat_id: chatId });
  },

  /**
   * Broadcasts a promo campaign to all active clubs in their topic thread:
   * 1) Immediately sends the photo (`fileId`) via `sendPhoto` (shared across all languages).
   * 2) Immediately follows up with the localized HTML text (`ru` | `en` | `de`) + inline button via `sendMessage`.
   */
  async broadcastPromoCampaign(promo: {
    fileId: string | null;
    textRu: string;
    textEn: string;
    textDe: string;
    buttonRu: string | null;
    buttonEn: string | null;
    buttonDe: string | null;
    targetUrl: string | null;
  }): Promise<number> {
    if (!env.TELEGRAM_BOT_TOKEN) return 0;

    const activeClubs = await db
      .select()
      .from(clubs)
      .where(and(eq(clubs.status, "active"), eq(clubs.isActive, true)));

    let sentCount = 0;
    const cleanFileId = promo.fileId?.trim() || "";

    for (const club of activeClubs) {
      const lang = normalizeLang(club.language);
      const text =
        lang === "en"
          ? promo.textEn
          : lang === "de"
            ? promo.textDe || promo.textEn
            : promo.textRu;
      const btnText =
        (lang === "en"
          ? promo.buttonEn
          : lang === "de"
            ? promo.buttonDe || promo.buttonEn
            : promo.buttonRu) || "ExtraPawn";

      // Step 1: Send photo first if file_id is specified
      if (cleanFileId) {
        const photoPayload: Record<string, unknown> = {
          chat_id: club.chatId,
          photo: cleanFileId,
        };
        if (club.topicThreadId > 0) {
          photoPayload.message_thread_id = club.topicThreadId;
        }
        const photoRes = await callTelegramJson("sendPhoto", photoPayload);
        if (!photoRes.ok) {
          console.error(
            `[TelegramBot] Promo sendPhoto failed for club ${club.chatId}:`,
            photoRes.description
          );
        }
      }

      // Step 2: Immediately send localized HTML text + inline button right below the photo
      const payload: Record<string, unknown> = {
        chat_id: club.chatId,
        parse_mode: "HTML",
        text,
      };
      if (club.topicThreadId > 0) {
        payload.message_thread_id = club.topicThreadId;
      }
      if (promo.targetUrl) {
        payload.reply_markup = {
          inline_keyboard: [[{ text: btnText, url: promo.targetUrl }]],
        };
      }
      const res = await callTelegramJson("sendMessage", payload);
      if (res.ok) sentCount += 1;
    }

    return sentCount;
  },

  /**
   * Fetches `getChatAdministrators` from Telegram and synchronizes `tele_app.club_admins`
   * so ONLY `creator` and `administrator` with `can_manage_topics === true` have settings access.
   */
  async syncClubAdminsFromTelegram(chatId: string): Promise<{
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
    const expiresAt = Date.now() + LIVE_ADMIN_CACHE_TTL_MS;
    for (const item of eligible) {
      liveAdminRoleCache.set(`${chatId}:${item.telegramId}`, {
        role: item.role,
        expiresAt,
      });
    }

    return {
      synced: true,
      creatorTelegramId: creatorEntry?.telegramId ?? null,
    };
  },

  /**
   * Verifies live in Telegram (`getChatMember`) whether `telegramId` currently holds
   * `creator` or `administrator` + `can_manage_topics === true` in `chatId`,
   * immediately updating `tele_app.club_admins` in PostgreSQL.
   */
  async verifyLiveClubManager(
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
        }
      );

      if (!res.ok || !res.result) {
        liveAdminRoleCache.set(cacheKey, {
          role: null,
          expiresAt: Date.now() + LIVE_ADMIN_CACHE_TTL_MS,
        });
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
      liveAdminRoleCache.set(cacheKey, {
        role,
        expiresAt: Date.now() + LIVE_ADMIN_CACHE_TTL_MS,
      });

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
      console.warn(
        `[TelegramBot] verifyLiveClubManager transient error for chat ${chatId}, user ${telegramId}:`,
        err instanceof Error ? err.message : err
      );
      return checkLocalDbFallback();
    }
  },

  /**
   * Stores the mandatory pre-selected club language (EN / DE / RU) chosen by an admin
   * in the Mini App right before clicking "Add Bot to Supergroup".
   */
  setPendingOnboardingLanguage(
    telegramId: string,
    language: AppLanguage
  ): void {
    setPendingOnboardingLanguageInternal(telegramId, language);
  },

  /**
   * Verifies that @ExtraPawnTeleBot itself still holds administrator status
   * with `can_manage_topics` and `can_delete_messages` in `chatId`.
   */
  async verifyBotHasClubPermissions(
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
  },

  /**
   * Handles real-time `chat_member` updates in connected supergroups when any member
   * is promoted, demoted, has `can_manage_topics` toggled, or leaves/is kicked.
   */
  async handleChatMemberUpdate(
    update: NonNullable<TelegramUpdate["chat_member"]>
  ): Promise<void> {
    if (update.chat.type !== "supergroup") return;
    const targetUser = update.new_chat_member?.user;
    if (!targetUser || targetUser.is_bot) return;

    const chatId = String(update.chat.id);
    const targetTelegramId = String(targetUser.id);
    invalidateClubLiveAdminCache(chatId, targetTelegramId);

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
    liveAdminRoleCache.set(`${chatId}:${targetTelegramId}`, {
      role,
      expiresAt: Date.now() + LIVE_ADMIN_CACHE_TTL_MS,
    });

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
  },

  /**
   * Handles `my_chat_member` updates when @ExtraPawnTeleBot is added, removed/kicked,
   * or has its administrator privileges modified in a group.
   */
  async handleMyChatMemberUpdate(
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
      await this.sendBlockedClubNoticeAndLeave(
        chatId,
        existingClub.topicThreadId,
        existingClub.language || clubLang
      );
      return;
    }

    // 3. Must be a supergroup
    if (update.chat.type !== "supergroup") {
      await this.leaveClubChat(chatId, texts.notSupergroup);
      return;
    }

    // 4. Verify bot's own administrator permissions (`can_manage_topics` & `can_delete_messages`)
    const isAdminStatus = status === "administrator";
    const hasManageTopics = Boolean(update.new_chat_member.can_manage_topics);
    const hasDeleteMessages = Boolean(
      update.new_chat_member.can_delete_messages
    );
    const botHasRequiredRights =
      isAdminStatus && hasManageTopics && hasDeleteMessages;

    if (!botHasRequiredRights) {
      // Brand-new onboarding without required admin rights -> instruct and leave cleanly
      if (!existingClub) {
        await this.leaveClubChat(chatId, texts.missingBotRights);
        return;
      }

      // Already registered club had bot's admin rights stripped -> pause club, preserve data, alert SuperAdmin!
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
        await this.leaveClubChat(chatId, texts.belowMinMembers(memberCount));
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
        await this.leaveClubChat(chatId, texts.inviterNotAllowed);
        return;
      }
    }

    // 7. Inspect chat administrators to identify real `creator` (if non-bot) before checking club limit
    const adminsRes = await callTelegramJson<TelegramChatMemberPayload[]>(
      "getChatAdministrators",
      { chat_id: chatId }
    );
    const creatorMember = Array.isArray(adminsRes.result)
      ? adminsRes.result.find(
          (m) => m.status === "creator" && !m.user?.is_bot
        )
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
        await this.leaveClubChat(
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
          await this.leaveClubChat(chatId, texts.topicsDisabled);
        }
        return;
      }
      topicThreadId = createdThreadId;
    }

    // 9. If reconnecting, verify existing topic still exists before saving; recreate if it was deleted
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

    // 10. Upsert club & synchronize all `creator` + `can_manage_topics` admins
    const persistedLanguage = normalizeLang(
      explicitChoice ?? existingClub?.language ?? clubLang
    );

    await db
      .insert(clubs)
      .values({
        chatId,
        title: update.chat.title || existingClub?.title || "Chess Club",
        username: update.chat.username || null,
        inviteLink: update.chat.username
          ? `https://t.me/${update.chat.username}/${topicThreadId}`
          : null,
        ownerTelegramId: effectiveOwnerId,
        topicThreadId,
        memberCount,
        language: persistedLanguage,
        status: "active",
        isActive: true,
        autoPaused: false,
        autoPauseChallengeId: null,
        autoPauseMessageId: null,
        weeklySchedule: createDefaultWeeklySchedule(),
      })
      .onConflictDoUpdate({
        target: clubs.chatId,
        set: {
          title: update.chat.title || existingClub?.title || "Chess Club",
          username: update.chat.username || null,
          inviteLink: update.chat.username
            ? `https://t.me/${update.chat.username}/${topicThreadId}`
            : existingClub?.inviteLink ?? null,
          ownerTelegramId: effectiveOwnerId,
          topicThreadId,
          memberCount,
          language: persistedLanguage,
          status: "active",
          isActive: true,
          updatedAt: new Date(),
        },
      });

    await this.clearAutoPause(chatId);
    await this.syncClubAdminsFromTelegram(chatId);

    if (isOnboardingOrReconnect && welcomeSent) {
      try {
        await this.publishChallengeToClub(chatId);
      } catch (err) {
        console.error(
          `[TelegramBot] Initial challenge publish failed for ${chatId}:`,
          err
        );
      }
    }
  },

  /**
   * Returns the latest published challenge in `chatId` that nobody has solved or surrendered yet,
   * or `null` if every published challenge has at least one completed (`solved` or `surrendered`) attempt.
   */
  async findLatestUnresolvedChallenge(chatId: string) {
    const published = await db
      .select()
      .from(clubChallenges)
      .where(eq(clubChallenges.chatId, chatId))
      .orderBy(desc(clubChallenges.publishedAt));

    if (published.length === 0) return null;

    const completedAttempts = await db
      .select({
        discipline: challengeAttempts.discipline,
        puzzleId: challengeAttempts.puzzleId,
        edition: challengeAttempts.edition,
      })
      .from(challengeAttempts)
      .where(
        and(
          eq(challengeAttempts.chatId, chatId),
          or(
            eq(challengeAttempts.status, "solved"),
            eq(challengeAttempts.status, "surrendered")
          )
        )
      );

    const resolvedKeys = new Set(
      completedAttempts.map((a) => `${a.discipline}:${a.puzzleId}:${a.edition}`)
    );

    const unresolved = published.find(
      (c) => !resolvedKeys.has(`${c.discipline}:${c.puzzleId}:${c.edition}`)
    );

    return unresolved ?? null;
  },

  /**
   * Clears `autoPaused` on the club and deletes the Telegram auto-pause notification message if present.
   */
  async clearAutoPause(chatId: string): Promise<void> {
    const [club] = await db
      .select({
        autoPaused: clubs.autoPaused,
        autoPauseChallengeId: clubs.autoPauseChallengeId,
        autoPauseMessageId: clubs.autoPauseMessageId,
      })
      .from(clubs)
      .where(eq(clubs.chatId, chatId))
      .limit(1);

    if (!club) return;

    if (
      club.autoPaused ||
      club.autoPauseChallengeId !== null ||
      club.autoPauseMessageId !== null
    ) {
      await db
        .update(clubs)
        .set({
          autoPaused: false,
          autoPauseChallengeId: null,
          autoPauseMessageId: null,
          updatedAt: new Date(),
        })
        .where(eq(clubs.chatId, chatId));
    }

    if (club.autoPauseMessageId) {
      await deleteTelegramMessage(chatId, club.autoPauseMessageId);
    }
  },

  /**
   * Clears `autoPaused` on the club once there are no unresolved challenges remaining.
   */
  async checkAndResumeAutoPause(chatId: string): Promise<void> {
    const unresolved = await this.findLatestUnresolvedChallenge(chatId);
    if (!unresolved) {
      await this.clearAutoPause(chatId);
    }
  },
};

const WEEKDAY_MAP: Record<string, DayOfWeekKey> = {
  mon: "mon",
  tue: "tue",
  wed: "wed",
  thu: "thu",
  fri: "fri",
  sat: "sat",
  sun: "sun",
};

function getClubZonedTime(
  now: Date,
  timezone: string
): { day: DayOfWeekKey; hour: number; minute: number } {
  const formatForZone = (tz: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatForZone(timezone || "Europe/Berlin");
  } catch {
    parts = formatForZone("Europe/Berlin");
  }

  const weekdayStr = (
    parts.find((p) => p.type === "weekday")?.value ?? "mon"
  ).toLowerCase();
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minuteStr = parts.find((p) => p.type === "minute")?.value ?? "0";

  const day = WEEKDAY_MAP[weekdayStr.slice(0, 3)] ?? "mon";
  const hour = Number.parseInt(hourStr, 10) % 24;
  const minute = Number.parseInt(minuteStr, 10) % 60;

  return {
    day,
    hour: Number.isNaN(hour) ? 0 : hour,
    minute: Number.isNaN(minute) ? 0 : minute,
  };
}

let pollingActive = false;
let lastUpdateOffset = 0;

async function pollTelegramUpdatesOnce(): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    const res = await callTelegramJson<TelegramUpdate[]>("getUpdates", {
      offset: lastUpdateOffset,
      timeout: 15,
      allowed_updates: ["message", "my_chat_member", "chat_member"],
    });
    if (!res.ok || !res.result) return;

    for (const upd of res.result) {
      lastUpdateOffset = Math.max(lastUpdateOffset, upd.update_id + 1);
      if (upd.my_chat_member) {
        await telegramBotService.handleMyChatMemberUpdate(upd.my_chat_member);
      } else if (upd.chat_member) {
        await telegramBotService.handleChatMemberUpdate(upd.chat_member);
      } else if (
        upd.message?.chat.type === "private" &&
        upd.message.text?.startsWith("/start")
      ) {
        const senderId = String(upd.message.from?.id ?? upd.message.chat.id);
        const userLang = await resolveUserLanguage(
          senderId,
          upd.message.from?.language_code
        );
        const startTexts = BOT_ONBOARDING_TEXTS[userLang];
        await callTelegramJson("sendMessage", {
          chat_id: String(upd.message.chat.id),
          parse_mode: "HTML",
          text: startTexts.privateStartText,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: startTexts.privateStartBtn,
                  url: `https://t.me/${env.BOT_USERNAME}?startapp=cabinet`,
                },
              ],
            ],
          },
        });
      }
    }
  } catch (err) {
    console.warn(
      "[TelegramBot] Polling transient network error (will retry in 2s):",
      err instanceof Error ? err.message : err
    );
  }
}

async function notifyAutoPauseReplyOnce(
  club: typeof clubs.$inferSelect,
  unresolvedChallenge: typeof clubChallenges.$inferSelect
): Promise<number | null> {
  if (!env.TELEGRAM_BOT_TOKEN) return null;

  const lang = normalizeLang(club.language);
  const text =
    lang === "en"
      ? [
          `⏸ <b>Auto-Paused</b>`,
          `This challenge has not been solved (or surrendered) by anyone yet. Scheduled challenges are paused so we don't spam the chat.`,
          `Solve or surrender the active challenge to automatically resume the schedule!`,
        ].join("\n")
      : lang === "de"
        ? [
            `⏸ <b>Auto-Pause</b>`,
            `Diese Challenge wurde noch von niemandem gelöst (oder aufgegeben). Geplante Challenges sind pausiert, um den Chat nicht zu überfluten.`,
            `Sobald jemand die aktive Challenge löst oder aufgibt, läuft der Zeitplan automatisch weiter!`,
          ].join("\n")
        : [
            `⏸ <b>Бот встал на авто-паузу</b>`,
            `Этот челлендж пока никто не решил (и не сдался). Автоматическая публикация приостановлена, чтобы не спамить в чате.`,
            `Как только кто-то затащит челлендж или сдастся — расписание продолжится автоматически!`,
          ].join("\n");

  const solveStartParam = encodeChallengeStartParam(
    unresolvedChallenge.discipline as ChallengeDiscipline,
    unresolvedChallenge.puzzleId,
    unresolvedChallenge.edition,
    club.chatId
  );

  const payload: Record<string, unknown> = {
    chat_id: club.chatId,
    parse_mode: "HTML",
    text,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text:
              lang === "en"
                ? "🔥 SOLVE ACTIVE"
                : lang === "de"
                  ? "🔥 AKTIVE CHALLENGE LÖSEN"
                  : "🔥 ЗАТАЩИТЬ ЧЕЛЛЕНДЖ",
            url: `https://t.me/${env.BOT_USERNAME}?startapp=${solveStartParam}`,
          },
        ],
      ],
    },
  };

  if (club.topicThreadId > 0) {
    payload.message_thread_id = club.topicThreadId;
  }
  if (unresolvedChallenge.tgMessageId) {
    payload.reply_parameters = {
      message_id: unresolvedChallenge.tgMessageId,
    };
  }

  const res = await callTelegramJson<{ message_id: number }>(
    "sendMessage",
    payload
  );
  return res.result?.message_id ?? null;
}

let lastSevenDayCleanupAt = 0;
let lastClubAdminsReconcileAt = 0;

async function reconcileConnectedClubsAdminsPeriodically(): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const nowMs = Date.now();
  const thirtyMinutesMs = 30 * 60 * 1000;
  if (nowMs - lastClubAdminsReconcileAt < thirtyMinutesMs) return;
  lastClubAdminsReconcileAt = nowMs;

  try {
    const connectedClubs = await db
      .select()
      .from(clubs)
      .where(
        and(ne(clubs.status, "blocked"), ne(clubs.status, "bot_removed"))
      );

    for (const club of connectedClubs) {
      if (!club.chatId.startsWith("-100")) continue;
      try {
        await telegramBotService.syncClubAdminsFromTelegram(club.chatId);
        const countRes = await callTelegramJson<number>("getChatMemberCount", {
          chat_id: club.chatId,
        });
        if (countRes.ok && typeof countRes.result === "number") {
          await db
            .update(clubs)
            .set({ memberCount: countRes.result })
            .where(eq(clubs.chatId, club.chatId));
        }
      } catch (err) {
        console.warn(
          `[TelegramBot] Periodic admin sync warning for club ${club.chatId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  } catch (err) {
    console.error("[TelegramBot] Periodic club admin reconcile error:", err);
  }
}

async function purgeExpiredSevenDayRecords(): Promise<void> {
  const nowMs = Date.now();
  const oneHourMs = 60 * 60 * 1000;
  if (nowMs - lastSevenDayCleanupAt < oneHourMs) return;
  lastSevenDayCleanupAt = nowMs;

  const cutoffDate = new Date(nowMs - 7 * 24 * 60 * 60 * 1000);
  try {
    await db
      .delete(challengeAttempts)
      .where(lt(challengeAttempts.updatedAt, cutoffDate));
    await db
      .delete(clubChallenges)
      .where(lt(clubChallenges.publishedAt, cutoffDate));
  } catch (err) {
    console.error("[TelegramBot] 7-day retention cleanup error:", err);
  }
}

async function runScheduledClubsTick(): Promise<void> {
  await purgeExpiredSevenDayRecords();
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await reconcileConnectedClubsAdminsPeriodically();
  try {
    const activeClubs = await db
      .select()
      .from(clubs)
      .where(and(eq(clubs.status, "active"), eq(clubs.isActive, true)));

    const now = new Date();
    for (const club of activeClubs) {
      // Recover missed initial challenge if a connected club has never published yet
      if (!club.lastPublishedAt && club.topicThreadId > 0) {
        try {
          await telegramBotService.publishChallengeToClub(club.chatId);
        } catch (err) {
          console.error(
            `[TelegramBot] Initial challenge recovery failed for club ${club.chatId}:`,
            err
          );
        }
        continue;
      }

      const schedule = normalizeWeeklySchedule(club.weeklySchedule);
      const zoned = getClubZonedTime(now, club.timezone);
      const dayConfig = schedule[zoned.day];
      if (!dayConfig.enabled || dayConfig.slots.length === 0) {
        continue;
      }

      const matchingSlot = dayConfig.slots.find((slot) => {
        if (zoned.hour < slot.from_hour || zoned.hour >= slot.to_hour) {
          return false;
        }
        const minutesSinceStart =
          (zoned.hour - slot.from_hour) * 60 + zoned.minute;
        const remainder = minutesSinceStart % slot.interval_minutes;
        // Allow a 5-minute grace window (0..5 min after the scheduled mark) so transient errors or restarts still publish
        return remainder >= 0 && remainder <= 5;
      });

      if (!matchingSlot) continue;

      if (club.lastPublishedAt) {
        const elapsedMs =
          now.getTime() - new Date(club.lastPublishedAt).getTime();
        const minCooldownMs =
          Math.max(8, matchingSlot.interval_minutes - 6) * 60 * 1000;
        if (elapsedMs < minCooldownMs) {
          continue;
        }
      }

      // Smart Auto-Pause: check if there is an unresolved active challenge in this club
      const unresolved = await telegramBotService.findLatestUnresolvedChallenge(
        club.chatId
      );
      if (unresolved) {
        if (
          !club.autoPaused &&
          club.autoPauseChallengeId !== unresolved.id
        ) {
          if (club.autoPauseMessageId) {
            await deleteTelegramMessage(club.chatId, club.autoPauseMessageId);
          }

          await db
            .update(clubs)
            .set({
              autoPaused: true,
              autoPauseChallengeId: unresolved.id,
              autoPauseMessageId: null,
              updatedAt: new Date(),
            })
            .where(eq(clubs.chatId, club.chatId));

          try {
            const pauseMessageId = await notifyAutoPauseReplyOnce(
              club,
              unresolved
            );
            if (pauseMessageId) {
              await db
                .update(clubs)
                .set({
                  autoPauseMessageId: pauseMessageId,
                  updatedAt: new Date(),
                })
                .where(eq(clubs.chatId, club.chatId));
            }
          } catch (err) {
            console.error(
              `[TelegramBot] Auto-pause notification failed for club ${club.chatId}:`,
              err
            );
          }
        }
        continue;
      }

      if (club.autoPaused || club.autoPauseMessageId !== null) {
        await telegramBotService.clearAutoPause(club.chatId);
      }

      try {
        await telegramBotService.publishChallengeToClub(club.chatId, {
          discipline: matchingSlot.discipline,
          difficulty: matchingSlot.difficulty,
          focusGroup: matchingSlot.focus_group,
          focusKey: matchingSlot.focus_key,
          objective: matchingSlot.objective,
        });
      } catch (err) {
        console.error(
          `[TelegramBot] Scheduled publish failed for club ${club.chatId}:`,
          err
        );
      }

      if (club.leaderboardCronDays > 0) {
        const cronIntervalMs = club.leaderboardCronDays * 24 * 60 * 60 * 1000;
        const shouldPostLeaderboard =
          !club.lastLeaderboardAt ||
          now.getTime() - new Date(club.lastLeaderboardAt).getTime() >=
            cronIntervalMs;
        if (shouldPostLeaderboard) {
          try {
            await telegramBotService.publishClubLeaderboardToTopic(club.chatId);
          } catch (err) {
            console.error(
              `[TelegramBot] Scheduled leaderboard post failed for club ${club.chatId}:`,
              err
            );
          }
        }
      }
    }
  } catch (err) {
    console.error("[TelegramBot] Scheduler tick error:", err);
  }
}

export function startTelegramBotBackgroundLoops(): void {
  if (!env.TELEGRAM_BOT_TOKEN || pollingActive) return;
  pollingActive = true;

  const loop = async () => {
    while (pollingActive) {
      await pollTelegramUpdatesOnce();
      await new Promise((r) => setTimeout(r, 2000));
    }
  };
  void loop();

  setTimeout(() => {
    void runScheduledClubsTick();
  }, 3_000);

  setInterval(() => {
    void runScheduledClubsTick();
  }, 60_000);
}

