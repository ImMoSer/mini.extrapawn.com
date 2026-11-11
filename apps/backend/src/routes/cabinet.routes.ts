import { desc, eq, inArray } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import {
  ALL_CHALLENGE_DISCIPLINES,
  calculateAttemptPoints,
  MAX_OWNED_CLUBS_PER_USER,
  roundPoints,
  type AppLanguage,
  type ChallengeAttemptStatus,
  type ChallengeDifficulty,
  type ChallengeDiscipline,
  type DisciplineAttemptStatsDTO,
  type UserCabinetDTO,
  type UserChallengeHistoryItemDTO,
} from "shared";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import {
  challengeAttempts,
  clubChallenges,
  clubs,
  users,
} from "../db/schema.js";
import { mapClubRowToSummaryDTO } from "../services/clubMapper.js";

export const cabinetRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/cabinet", { preHandler: [fastify.authenticate] }, async (req) => {
    const viewer = req.user;

    const [userRow] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, viewer.telegramId))
      .limit(1);

    const userAttempts = await db
      .select()
      .from(challengeAttempts)
      .where(eq(challengeAttempts.telegramId, viewer.telegramId));

    const stats = {} as Record<ChallengeDiscipline, DisciplineAttemptStatsDTO>;
    for (const disc of ALL_CHALLENGE_DISCIPLINES) {
      stats[disc] = {
        discipline: disc,
        total_attempts: 0,
        solved_count: 0,
        failed_count: 0,
        total_points: 0,
        total_time_ms: 0,
      };
    }

    for (const att of userAttempts) {
      const disc = att.discipline as ChallengeDiscipline;
      const bucket = stats[disc];
      if (!bucket) continue;

      const wrongMoves = att.solved
        ? Math.max(0, att.attempts - 1)
        : att.attempts;

      bucket.total_attempts += att.attempts;
      bucket.failed_count += wrongMoves + (att.status === "surrendered" && wrongMoves === 0 ? 1 : 0);

      if (att.solved) {
        bucket.solved_count += 1;
        bucket.total_points = roundPoints(
          bucket.total_points + calculateAttemptPoints(att.solved, att.attempts)
        );
        bucket.total_time_ms += Number(att.solvedTimeMs ?? 0);
      }
    }

    const allClubRows = await db
      .select()
      .from(clubs)
      .orderBy(desc(clubs.isDefault), desc(clubs.memberCount));

    const clubDtos = await Promise.all(
      allClubRows.map((c) =>
        mapClubRowToSummaryDTO(c, viewer.telegramId, viewer.isSuperadmin)
      )
    );

    const visibleClubs = clubDtos.filter(
      (c) => c.status !== "bot_removed" && c.status !== "blocked"
    );
    const myClubs = visibleClubs.filter((c) => c.is_admin);
    const ownedClubsCount = visibleClubs.filter(
      (c) =>
        !c.is_default &&
        (viewer.isSuperadmin
          ? c.owner_telegram_id === viewer.telegramId
          : c.is_admin)
    ).length;

    const clubTitleByChatId = new Map<string, string>(
      allClubRows.map((c) => [c.chatId, c.title])
    );

    const completedUserAttempts = userAttempts
      .filter((a) => a.status === "solved" || a.status === "surrendered")
      .sort((a, b) => {
        const tA = (a.completedAt ?? a.updatedAt).getTime();
        const tB = (b.completedAt ?? b.updatedAt).getTime();
        return tB - tA;
      });

    const historyChatIds = Array.from(
      new Set(completedUserAttempts.map((a) => a.chatId))
    );

    const [historyChallenges, historyClubAttempts] =
      historyChatIds.length > 0
        ? await Promise.all([
            db
              .select()
              .from(clubChallenges)
              .where(inArray(clubChallenges.chatId, historyChatIds)),
            db
              .select()
              .from(challengeAttempts)
              .where(inArray(challengeAttempts.chatId, historyChatIds)),
          ])
        : [[], []];

    const challengeMetaByKey = new Map(
      historyChallenges.map((c) => [
        `${c.chatId}:${c.discipline}:${c.puzzleId}:${c.edition}`,
        c,
      ])
    );

    const socialByKey = new Map<
      string,
      { solvedCount: number; bestTimeMs: number | null }
    >();
    for (const att of historyClubAttempts) {
      if (!att.solved) continue;
      const key = `${att.chatId}:${att.discipline}:${att.puzzleId}:${att.edition}`;
      let bucket = socialByKey.get(key);
      if (!bucket) {
        bucket = { solvedCount: 0, bestTimeMs: null };
        socialByKey.set(key, bucket);
      }
      bucket.solvedCount += 1;
      if (att.solvedTimeMs !== null && att.solvedTimeMs !== undefined) {
        const ms = Number(att.solvedTimeMs);
        if (bucket.bestTimeMs === null || ms < bucket.bestTimeMs) {
          bucket.bestTimeMs = ms;
        }
      }
    }

    const history: UserChallengeHistoryItemDTO[] = completedUserAttempts.map(
      (att) => {
        const key = `${att.chatId}:${att.discipline}:${att.puzzleId}:${att.edition}`;
        const ch = challengeMetaByKey.get(key);
        const social = socialByKey.get(key);
        const completedAtIso = (att.completedAt ?? att.updatedAt).toISOString();

        return {
          chat_id: att.chatId,
          club_title:
            clubTitleByChatId.get(att.chatId) ??
            (att.chatId === env.DEFAULT_CLUB_CHAT_ID
              ? env.DEFAULT_CLUB_TITLE
              : `Club ${att.chatId}`),
          discipline: att.discipline as ChallengeDiscipline,
          puzzle_id: att.puzzleId,
          edition: att.edition,
          difficulty: ((ch?.difficulty as ChallengeDifficulty) || "Novice"),
          category: ch?.category || ch?.domain || "MIX",
          domain: ch?.domain || "",
          published_at: ch?.publishedAt
            ? ch.publishedAt.toISOString()
            : completedAtIso,
          completed_at: completedAtIso,
          solved_count: social?.solvedCount ?? (att.solved ? 1 : 0),
          best_time_ms:
            social?.bestTimeMs ??
            (att.solved && att.solvedTimeMs !== null
              ? Number(att.solvedTimeMs)
              : null),
          my_status: att.status as ChallengeAttemptStatus,
          my_solved: att.solved,
          my_points: roundPoints(
            calculateAttemptPoints(att.solved, att.attempts)
          ),
          my_attempts: att.attempts,
        };
      }
    );

    const response: UserCabinetDTO = {
      user: {
        telegram_id: viewer.telegramId,
        username: userRow?.username ?? viewer.username,
        first_name: userRow?.firstName ?? viewer.firstName,
        last_name: userRow?.lastName ?? viewer.lastName,
        avatar_url: userRow?.avatarUrl ?? viewer.avatarUrl,
        language_code: ((userRow?.languageCode ||
          viewer.languageCode) as AppLanguage) || "ru",
        is_superadmin: viewer.isSuperadmin,
        created_at: userRow?.createdAt
          ? userRow.createdAt.toISOString()
          : new Date().toISOString(),
      },
      stats,
      history,
      clubs: visibleClubs,
      my_clubs: myClubs,
      owned_clubs_count: ownedClubsCount,
      max_owned_clubs: MAX_OWNED_CLUBS_PER_USER,
      default_chat_id: env.DEFAULT_CLUB_CHAT_ID,
      bot_username: env.BOT_USERNAME,
    };

    return response;
  });

  fastify.patch<{ Body: { language_code: AppLanguage } }>(
    "/cabinet/language",
    { preHandler: [fastify.authenticate] },
    async (req) => {
      const lang: AppLanguage =
        req.body.language_code === "en"
          ? "en"
          : req.body.language_code === "de"
            ? "de"
            : "ru";

      await db
        .update(users)
        .set({ languageCode: lang, updatedAt: new Date() })
        .where(eq(users.telegramId, req.user.telegramId));

      return { ok: true, language_code: lang };
    }
  );
};

