import { and, desc, eq, or } from "drizzle-orm";
import { encodeChallengeStartParam, type ChallengeDiscipline } from "shared";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { challengeAttempts, clubChallenges, clubs } from "../db/schema.js";
import {
  callTelegramJson,
  deleteTelegramMessage,
  normalizeLang,
} from "./telegramApi.js";

/**
 * Returns the latest published challenge in `chatId` that nobody has solved or surrendered yet,
 * or `null` if every published challenge has at least one completed (`solved` or `surrendered`) attempt.
 */
export async function findLatestUnresolvedChallenge(chatId: string) {
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
}

/**
 * Clears `autoPaused` on the club and deletes the Telegram auto-pause notification message if present.
 */
export async function clearAutoPause(chatId: string): Promise<void> {
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
}

/**
 * Clears `autoPaused` on the club once there are no unresolved challenges remaining.
 */
export async function checkAndResumeAutoPause(chatId: string): Promise<void> {
  const unresolved = await findLatestUnresolvedChallenge(chatId);
  if (!unresolved) {
    await clearAutoPause(chatId);
  }
}

export async function notifyAutoPauseReplyOnce(
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
