import { and, eq, isNotNull, ne } from "drizzle-orm";
import {
  ALL_DAYS_OF_WEEK,
  encodeChallengeStartParam,
  encodeClubLeaderboardStartParam,
  normalizeWeeklySchedule,
  type ChallengeDifficulty,
  type ChallengeDiscipline,
  type ClubScheduleSlot,
} from "shared";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { db } from "../db/index.js";
import { clubChallenges, clubs } from "../db/schema.js";
import { renderBoardPng } from "../services/boardImage.service.js";
import { puzzleClientService } from "../services/puzzleClient.service.js";
import { handleClubSendPermissionFailure } from "./botAdminSync.js";
import { clearAutoPause } from "./botAutoPause.js";
import { buildChallengeCaption, getClubZonedTime } from "./botTexts.js";
import type {
  ClubPublishOverride,
  PromoBroadcastPayload,
} from "./botTypes.js";
import {
  callTelegramJson,
  flushClubTopicMessagesOnPublish,
  normalizeLang,
  sendTelegramPhotoWithOutcome,
} from "./telegramApi.js";

// Per-club lock preventing concurrent `publishChallengeToClub` executions
const inFlightClubPublishes = new Set<string>();

/**
 * Selects a fresh puzzle for the club, renders board.png, posts to the club's topic thread,
 * and saves the challenge record in `tele_app.club_challenges`.
 */
export async function publishChallengeToClub(
  chatId: string,
  override?: ClubPublishOverride
) {
  if (inFlightClubPublishes.has(chatId)) {
    logger.warn(
      { event: "publish_skipped_in_flight", chatId },
      "Skipping concurrent publishChallengeToClub"
    );
    return null;
  }
  inFlightClubPublishes.add(chatId);

  try {
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

    const previousRows = await db
      .select({
        puzzleId: clubChallenges.puzzleId,
        edition: clubChallenges.edition,
      })
      .from(clubChallenges)
      .where(
        and(
          eq(clubChallenges.chatId, chatId),
          eq(clubChallenges.discipline, chosenDiscipline)
        )
      );
    const excludeIds = previousRows.map((r) => r.puzzleId);
    const maxPrevEdition = previousRows.reduce((max, r) => {
      const parsed = Number.parseInt(r.edition, 10);
      return Number.isFinite(parsed) && parsed > max ? parsed : max;
    }, 0);

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

    const edition = String(maxPrevEdition + 1);
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

    // Persist snapshot BEFORE network upload so even if Telegram responds slowly (>60s)
    // and delivers asynchronously, the solve button never points to a missing DB row.
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
        tgMessageId: null,
      })
      .onConflictDoUpdate({
        target: [
          clubChallenges.chatId,
          clubChallenges.discipline,
          clubChallenges.puzzleId,
          clubChallenges.edition,
        ],
        set: {
          publishedAt: new Date(),
        },
      })
      .returning();

    if (!inserted) {
      throw new Error(
        `[TelegramBot] Failed inserting challenge snapshot for chat ${chatId}`
      );
    }

    const photoOutcome = await sendTelegramPhotoWithOutcome({
      chatId,
      messageThreadId: club.topicThreadId,
      pngBuffer,
      caption,
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

    const tgMessageId = photoOutcome.messageId;

    if (!tgMessageId && env.TELEGRAM_BOT_TOKEN) {
      if (photoOutcome.deliveryUncertain) {
        logger.warn(
          {
            event: "publish_delivery_uncertain",
            chatId,
            challengeId: inserted.id,
          },
          "sendPhoto delivery uncertain; keeping snapshot to prevent duplicates"
        );
        await db
          .update(clubs)
          .set({
            lastPublishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(clubs.chatId, chatId));
        await clearAutoPause(chatId);
        return inserted;
      }

      await db
        .delete(clubChallenges)
        .where(eq(clubChallenges.id, inserted.id));

      if (photoOutcome.apiErrorDescription) {
        await handleClubSendPermissionFailure(
          club,
          photoOutcome.apiErrorDescription
        );
      }
      throw new Error(
        `[TelegramBot] sendPhoto returned no message_id for chat ${chatId} (thread ${club.topicThreadId})${photoOutcome.apiErrorDescription ? `: ${photoOutcome.apiErrorDescription}` : ""}`
      );
    }

    const previousActiveMessages = await db
      .select({
        id: clubChallenges.id,
        tgMessageId: clubChallenges.tgMessageId,
      })
      .from(clubChallenges)
      .where(
        and(
          eq(clubChallenges.chatId, chatId),
          ne(clubChallenges.id, inserted.id),
          isNotNull(clubChallenges.tgMessageId)
        )
      );

    const previousBoardIds = previousActiveMessages
      .map((prev) => prev.tgMessageId)
      .filter((id): id is number => Boolean(id && id !== tgMessageId));

    await flushClubTopicMessagesOnPublish(
      chatId,
      tgMessageId ?? null,
      previousBoardIds
    );

    if (previousActiveMessages.length > 0) {
      await db
        .update(clubChallenges)
        .set({ tgMessageId: null })
        .where(
          and(
            eq(clubChallenges.chatId, chatId),
            ne(clubChallenges.id, inserted.id),
            isNotNull(clubChallenges.tgMessageId)
          )
        );
    }

    const [finalized] = tgMessageId
      ? await db
          .update(clubChallenges)
          .set({ tgMessageId })
          .where(eq(clubChallenges.id, inserted.id))
          .returning()
      : [inserted];

    await db
      .update(clubs)
      .set({
        lastPublishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(clubs.chatId, chatId));

    await clearAutoPause(chatId);

    const published = finalized ?? inserted;
    logger.info(
      {
        event: "challenge_published",
        chatId,
        challengeId: published.id,
        discipline: puzzle.discipline,
        puzzleId: puzzle.puzzleId,
        edition,
      },
      "Published club challenge"
    );
    return published;
  } finally {
    inFlightClubPublishes.delete(chatId);
  }
}

/**
 * Broadcasts a promo campaign to all active clubs in their topic thread:
 * 1) Immediately sends the photo (`fileId`) via `sendPhoto` (shared across all languages).
 * 2) Immediately follows up with the localized HTML text (`ru` | `en` | `de`) + inline button via `sendMessage`.
 */
export async function broadcastPromoCampaign(
  promo: PromoBroadcastPayload
): Promise<number> {
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
        logger.error(
          {
            event: "promo_photo_failed",
            chatId: club.chatId,
            description: photoRes.description,
          },
          "Promo sendPhoto failed"
        );
      }
    }

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

  logger.info(
    { event: "promo_broadcasted", sentCount, activeClubs: activeClubs.length },
    "Broadcasted promo campaign"
  );
  return sentCount;
}
