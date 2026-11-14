import { and, desc, eq, gte } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import {
  ALL_CHALLENGE_DISCIPLINES,
  calculateAttemptPoints,
  MAX_OWNED_CLUBS_PER_USER,
  roundPoints,
  type AppLanguage,
  type ChallengeDiscipline,
  type DisciplineAttemptStatsDTO,
  type UserCabinetDTO,
} from "shared";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import {
  challengeAttempts,
  clubs,
  users,
} from "../db/schema.js";
import { mapClubRowToSummaryDTO } from "../services/clubMapper.js";

export const cabinetRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/cabinet", { preHandler: [fastify.authenticate] }, async (req) => {
    const viewer = req.user;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [userRow] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, viewer.telegramId))
      .limit(1);

    const userAttempts = await db
      .select()
      .from(challengeAttempts)
      .where(
        and(
          eq(challengeAttempts.telegramId, viewer.telegramId),
          gte(challengeAttempts.updatedAt, sevenDaysAgo)
        )
      );

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
      .orderBy(desc(clubs.memberCount));

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
      (c) => c.owner_telegram_id === viewer.telegramId
    ).length;

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
        terms_accepted_at: userRow?.termsAcceptedAt
          ? userRow.termsAcceptedAt.toISOString()
          : null,
        created_at: userRow?.createdAt
          ? userRow.createdAt.toISOString()
          : new Date().toISOString(),
      },
      stats,
      clubs: visibleClubs,
      my_clubs: myClubs,
      owned_clubs_count: ownedClubsCount,
      max_owned_clubs: MAX_OWNED_CLUBS_PER_USER,
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

  fastify.post(
    "/cabinet/accept-terms",
    { preHandler: [fastify.authenticate] },
    async (req) => {
      const now = new Date();
      await db
        .update(users)
        .set({ termsAcceptedAt: now, updatedAt: now })
        .where(eq(users.telegramId, req.user.telegramId));

      return { ok: true, terms_accepted_at: now.toISOString() };
    }
  );
};

