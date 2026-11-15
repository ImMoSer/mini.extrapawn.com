import { and, desc, eq } from "drizzle-orm";
import {
  encodeClubLeaderboardStartParam,
  encodeReplayStartParam,
  type ChallengeDiscipline,
} from "shared";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { clubChallenges, clubs } from "../db/schema.js";
import {
  appendClubTopicMessageId,
  callTelegramJson,
  escapeHtml,
  normalizeLang,
} from "./telegramApi.js";

export interface NotifyChallengeSolvedParams {
  chatId: string;
  discipline: ChallengeDiscipline;
  puzzleId: string;
  edition: string;
  attemptId: number;
  username: string;
  attempts: number;
  timeMs: number;
  userMovesCount: number;
  hasMoveTimings: boolean;
}

/**
 * Sends the notification to the club's topic thread when a player solves a challenge:
 * - For `tactics`: "{{username}} 🤝\nПопыток - {{attempts}}\nСекунд - {{seconds}}" + [🏆 ТАБЛИЦА]
 * - For non-tactics: "{{username}} 🤝\nПопыток - {{attempts}}\nХодов - {{moves}}" + [▶ | ▶▶]
 * Stored in `clubs.topic_message_ids` and batch-deleted when the next challenge is published.
 */
export async function sendChallengeSolvedNotification(
  params: NotifyChallengeSolvedParams
): Promise<void> {
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

  const lang = normalizeLang(club.language);
  let text: string;
  let inlineButtonsRow: Array<{ text: string; url: string }>;

  if (params.discipline === "tactics") {
    const seconds = Math.round((params.timeMs / 1000) * 10) / 10;
    text =
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

    inlineButtonsRow = [
      {
        text: tableBtnText,
        url: `https://t.me/${env.BOT_USERNAME}?startapp=${recordsStartParam}`,
      },
    ];
  } else {
    const safeMoves = Math.max(1, params.userMovesCount);
    text =
      lang === "en"
        ? `${params.username} 🤝\nAttempts - ${params.attempts}\nMoves - ${safeMoves}`
        : lang === "de"
          ? `${params.username} 🤝\nVersuche - ${params.attempts}\nZüge - ${safeMoves}`
          : `${params.username} 🤝\nПопыток - ${params.attempts}\nХодов - ${safeMoves}`;

    const gameStartParam = encodeReplayStartParam("game", params.attemptId);
    const fastStartParam = encodeReplayStartParam("fast", params.attemptId);

    inlineButtonsRow = params.hasMoveTimings
      ? [
          {
            text: "▶",
            url: `https://t.me/${env.BOT_USERNAME}?startapp=${gameStartParam}`,
          },
          {
            text: "▶▶",
            url: `https://t.me/${env.BOT_USERNAME}?startapp=${fastStartParam}`,
          },
        ]
      : [
          {
            text: "▶▶",
            url: `https://t.me/${env.BOT_USERNAME}?startapp=${fastStartParam}`,
          },
        ];
  }

  const payload: Record<string, unknown> = {
    chat_id: params.chatId,
    text,
    reply_markup: {
      inline_keyboard: [inlineButtonsRow],
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
  await appendClubTopicMessageId(params.chatId, sendRes.result?.message_id);
}

/**
 * Sends a concise notification to the club's topic thread when an admin saves club settings,
 * recording its `message_id` for cleanup when the next challenge is published.
 */
export async function sendClubSettingsUpdatedNotification(params: {
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

  const sendRes = await callTelegramJson<{ message_id: number }>(
    "sendMessage",
    payload
  );
  await appendClubTopicMessageId(params.chatId, sendRes.result?.message_id);
}
