import { eq } from "drizzle-orm";
import {
  formatFocusLabel,
  type AppLanguage,
  type ChallengeDifficulty,
  type ChallengeDiscipline,
  type DayOfWeekKey,
} from "shared";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import type { NormalizedChallengePuzzle } from "../services/puzzleClient.service.js";
import { normalizeLang } from "./telegramApi.js";

// Stores explicit club language selected by an admin via the mandatory EN/DE/RU checkboxes in Mini App before adding the bot
const PENDING_ONBOARDING_LANG_TTL_MS = 2 * 60 * 60 * 1000;
const pendingOnboardingLanguages = new Map<
  string,
  { language: AppLanguage; expiresAt: number }
>();

export function setPendingOnboardingLanguageInternal(
  telegramId: string,
  language: AppLanguage
): void {
  pendingOnboardingLanguages.set(telegramId, {
    language: normalizeLang(language),
    expiresAt: Date.now() + PENDING_ONBOARDING_LANG_TTL_MS,
  });
}

export function getPendingOnboardingLanguageInternal(
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

function resolveLangFromTelegramCode(rawCode?: string | null): AppLanguage {
  if (!rawCode) return "en";
  const lower = rawCode.trim().toLowerCase();
  if (lower.startsWith("de")) return "de";
  if (lower.startsWith("ru")) return "ru";
  return "en";
}

export async function resolveUserLanguage(
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

export async function resolveOnboardingLanguage(params: {
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

export const BOT_ONBOARDING_TEXTS = {
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

export function buildChallengeCaption(
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

const WEEKDAY_MAP: Record<string, DayOfWeekKey> = {
  mon: "mon",
  tue: "tue",
  wed: "wed",
  thu: "thu",
  fri: "fri",
  sat: "sat",
  sun: "sun",
};

export function getClubZonedTime(
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
