import { and, desc, eq, gte, ne } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import {
  ALL_DAYS_OF_WEEK,
  calculateAttemptPoints,
  normalizeWeeklySchedule,
  roundPoints,
  type ChallengeDifficulty,
  type ChallengeDiscipline,
  type ClubCompetitionRowDTO,
  type ClubsCompetitionResponseDTO,
  type UpdateClubSettingsRequest,
} from "shared";
import { telegramBotService } from "../bot/telegramBot.service.js";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { challengeAttempts, clubAdmins, clubs } from "../db/schema.js";
import { mapClubRowToSummaryDTO } from "../services/clubMapper.js";

export const clubsRoutes: FastifyPluginAsync = async (fastify) => {
  // Inter-Club Monthly Competition Leaderboard (/api/clubs/leaderboard)
  fastify.get(
    "/clubs/leaderboard",
    { preHandler: [fastify.authenticate] },
    async (req): Promise<ClubsCompetitionResponseDTO> => {
      const periodDays = 30;
      const sinceDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
      const viewerId = req.user.telegramId;

      // Ensure official EXTRAPAWNCLUB row always exists so /clubs is never empty
      await db
        .insert(clubs)
        .values({
          chatId: env.DEFAULT_CLUB_CHAT_ID,
          title: env.DEFAULT_CLUB_TITLE,
          username: "EXTRAPAWNCLUB",
          ownerTelegramId: env.SUPERADMIN_TELEGRAM_ID,
          topicThreadId: env.DEFAULT_CLUB_THREAD_ID,
          isDefault: true,
          isActive: true,
          status: "active",
        })
        .onConflictDoNothing();

      const clubRows = await db
        .select()
        .from(clubs)
        .where(
          and(ne(clubs.status, "blocked"), ne(clubs.status, "bot_removed"))
        )
        .orderBy(desc(clubs.isDefault), desc(clubs.memberCount));

      const [recentSolved, myAttempts, myAdminRows] = await Promise.all([
        db
          .select()
          .from(challengeAttempts)
          .where(
            and(
              eq(challengeAttempts.solved, true),
              gte(challengeAttempts.updatedAt, sinceDate)
            )
          ),
        db
          .select({ chatId: challengeAttempts.chatId })
          .from(challengeAttempts)
          .where(eq(challengeAttempts.telegramId, viewerId)),
        db
          .select({ chatId: clubAdmins.chatId })
          .from(clubAdmins)
          .where(eq(clubAdmins.telegramId, viewerId)),
      ]);

      const participatedChatIds = new Set(myAttempts.map((a) => a.chatId));
      const adminChatIds = new Set(myAdminRows.map((a) => a.chatId));

      interface ClubAccumulator {
        tactics: number;
        theoretical: number;
        practical: number;
        finishhim: number;
        solvedCount: number;
        players: Set<string>;
      }

      const accByChatId = new Map<string, ClubAccumulator>();
      for (const att of recentSolved) {
        let acc = accByChatId.get(att.chatId);
        if (!acc) {
          acc = {
            tactics: 0,
            theoretical: 0,
            practical: 0,
            finishhim: 0,
            solvedCount: 0,
            players: new Set<string>(),
          };
          accByChatId.set(att.chatId, acc);
        }

        const pts = calculateAttemptPoints(att.solved, att.attempts);
        acc.solvedCount += 1;
        acc.players.add(att.telegramId);

        if (att.discipline === "tactics") acc.tactics += pts;
        else if (att.discipline === "theoretical_endgames")
          acc.theoretical += pts;
        else if (att.discipline === "practical_chess") acc.practical += pts;
        else if (att.discipline === "finishhim") acc.finishhim += pts;
      }

      const rows: ClubCompetitionRowDTO[] = clubRows.map((c) => {
        const acc = accByChatId.get(c.chatId);
        const tacticsPts = roundPoints(acc?.tactics ?? 0);
        const theoreticalPts = roundPoints(acc?.theoretical ?? 0);
        const practicalPts = roundPoints(acc?.practical ?? 0);
        const finishhimPts = roundPoints(acc?.finishhim ?? 0);
        const totalPts = roundPoints(
          tacticsPts + theoreticalPts + practicalPts + finishhimPts
        );
        const avgPts = roundPoints(totalPts / 4);
        const isAdmin =
          req.user.isSuperadmin ||
          c.ownerTelegramId === viewerId ||
          adminChatIds.has(c.chatId);
        const isMember =
          c.isDefault || isAdmin || participatedChatIds.has(c.chatId);
        const isActive = Boolean(c.isActive) && c.status === "active";

        return {
          rank: 0,
          chat_id: c.chatId,
          title: c.title,
          username: c.username ?? null,
          is_default: c.isDefault,
          is_member: isMember,
          is_admin: isAdmin,
          is_active: isActive,
          auto_paused: Boolean(c.autoPaused),
          member_count: c.memberCount,
          active_players_30d: acc ? acc.players.size : 0,
          solved_count_30d: acc?.solvedCount ?? 0,
          tactics_points: tacticsPts,
          theoretical_points: theoreticalPts,
          practical_points: practicalPts,
          finishhim_points: finishhimPts,
          total_points: totalPts,
          average_points: avgPts,
        };
      });

      rows.sort((a, b) => {
        if (b.total_points !== a.total_points) {
          return b.total_points - a.total_points;
        }
        if (b.solved_count_30d !== a.solved_count_30d) {
          return b.solved_count_30d - a.solved_count_30d;
        }
        if (a.is_default !== b.is_default) {
          return a.is_default ? -1 : 1;
        }
        return b.member_count - a.member_count;
      });

      rows.forEach((r, idx) => {
        r.rank = idx + 1;
      });

      return {
        period_days: periodDays,
        clubs: rows,
      };
    }
  );

  fastify.get<{ Params: { chatId: string } }>(
    "/clubs/:chatId",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const [row] = await db
        .select()
        .from(clubs)
        .where(eq(clubs.chatId, req.params.chatId))
        .limit(1);

      if (!row) {
        return reply.code(404).send({ error: "Club not found" });
      }

      return mapClubRowToSummaryDTO(
        row,
        req.user.telegramId,
        req.user.isSuperadmin
      );
    }
  );

  fastify.patch<{
    Params: { chatId: string };
    Body: { is_active: boolean };
  }>(
    "/clubs/:chatId/active",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const [row] = await db
        .select()
        .from(clubs)
        .where(eq(clubs.chatId, req.params.chatId))
        .limit(1);

      if (!row) {
        return reply.code(404).send({ error: "Club not found" });
      }

      const dtoBefore = await mapClubRowToSummaryDTO(
        row,
        req.user.telegramId,
        req.user.isSuperadmin
      );
      if (!dtoBefore.is_admin) {
        return reply
          .code(403)
          .send({ error: "Forbidden: You are not an admin of this club" });
      }
      if (row.status === "blocked" && !req.user.isSuperadmin) {
        return reply
          .code(403)
          .send({ error: "This club has been blocked by SuperAdmin" });
      }

      const nextIsActive = Boolean(req.body.is_active);
      const nextStatus =
        row.status === "blocked" && !req.user.isSuperadmin
          ? "blocked"
          : nextIsActive
            ? "active"
            : "paused";

      const [updated] = await db
        .update(clubs)
        .set({
          isActive: nextIsActive,
          status: nextStatus,
          autoPaused: false,
          autoPauseChallengeId: null,
          updatedAt: new Date(),
        })
        .where(eq(clubs.chatId, req.params.chatId))
        .returning();

      return mapClubRowToSummaryDTO(
        updated ?? row,
        req.user.telegramId,
        req.user.isSuperadmin
      );
    }
  );

  fastify.put<{
    Params: { chatId: string };
    Body: UpdateClubSettingsRequest;
  }>(
    "/clubs/:chatId/settings",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const [row] = await db
        .select()
        .from(clubs)
        .where(eq(clubs.chatId, req.params.chatId))
        .limit(1);

      if (!row) {
        return reply.code(404).send({ error: "Club not found" });
      }

      const dtoBefore = await mapClubRowToSummaryDTO(
        row,
        req.user.telegramId,
        req.user.isSuperadmin
      );

      if (!dtoBefore.is_admin) {
        return reply
          .code(403)
          .send({ error: "Forbidden: You are not an admin of this club" });
      }

      if (row.status === "blocked" && !req.user.isSuperadmin) {
        return reply
          .code(403)
          .send({ error: "This club has been blocked by SuperAdmin" });
      }

      const body = req.body;
      const weeklySchedule = normalizeWeeklySchedule(
        body.weekly_schedule ?? row.weeklySchedule
      );

      // Validate non-overlapping intervals within each day
      for (const day of ALL_DAYS_OF_WEEK) {
        const slots = weeklySchedule[day].slots;
        if (slots.length > 8) {
          return reply.code(400).send({
            error: "Не более 8 интервалов на один день недели / Max 8 intervals per day",
          });
        }
        for (let i = 0; i < slots.length; i += 1) {
          const cur = slots[i];
          if (!cur || cur.from_hour >= cur.to_hour) {
            return reply.code(400).send({
              error: "Время начала интервала должно быть меньше времени окончания",
            });
          }
          if (i > 0) {
            const prev = slots[i - 1];
            if (prev && cur.from_hour < prev.to_hour) {
              return reply.code(400).send({
                error: "Интервалы расписания в пределах одного дня не должны пересекаться",
              });
            }
          }
        }
      }

      const nextIsActive =
        typeof body.is_active === "boolean"
          ? body.is_active
          : Boolean(row.isActive);
      const nextStatus =
        row.status === "blocked" && !req.user.isSuperadmin
          ? "blocked"
          : body.status || (nextIsActive ? "active" : "paused");

      // Derive fallback filter_disciplines/difficulties from schedule slots for manual publish-now
      const allSlotDisciplines = new Set<ChallengeDiscipline>();
      const allSlotDifficulties = new Set<ChallengeDifficulty>();
      for (const day of ALL_DAYS_OF_WEEK) {
        if (!weeklySchedule[day].enabled) continue;
        for (const s of weeklySchedule[day].slots) {
          allSlotDisciplines.add(s.discipline);
          allSlotDifficulties.add(s.difficulty);
        }
      }

      const [updated] = await db
        .update(clubs)
        .set({
          isActive: nextIsActive,
          language: body.language || row.language,
          timezone: body.timezone || row.timezone,
          status: nextStatus,
          weeklySchedule,
          scheduleTimes: body.schedule_times?.length
            ? body.schedule_times
            : row.scheduleTimes,
          leaderboardCronDays:
            body.leaderboard_cron_days ?? row.leaderboardCronDays,
          filterDisciplines: body.filter_disciplines?.length
            ? body.filter_disciplines
            : allSlotDisciplines.size > 0
              ? Array.from(allSlotDisciplines)
              : row.filterDisciplines,
          filterDifficulties: body.filter_difficulties?.length
            ? body.filter_difficulties
            : allSlotDifficulties.size > 0
              ? Array.from(allSlotDifficulties)
              : row.filterDifficulties,
          filterFocusGroup: body.filter_focus_group || row.filterFocusGroup,
          filterFocusKeys: body.filter_focus_keys?.length
            ? body.filter_focus_keys
            : row.filterFocusKeys,
          filterObjective: body.filter_objective || row.filterObjective,
          updatedAt: new Date(),
        })
        .where(eq(clubs.chatId, req.params.chatId))
        .returning();

      return mapClubRowToSummaryDTO(
        updated ?? row,
        req.user.telegramId,
        req.user.isSuperadmin
      );
    }
  );

  fastify.post<{
    Params: { chatId: string };
    Body?: {
      discipline?: ChallengeDiscipline;
      difficulty?: ChallengeDifficulty;
      focusGroup?: string;
      focusKey?: string;
      objective?: string;
      puzzleId?: string;
    };
  }>(
    "/clubs/:chatId/publish-now",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const [row] = await db
        .select()
        .from(clubs)
        .where(eq(clubs.chatId, req.params.chatId))
        .limit(1);

      if (!row) {
        return reply.code(404).send({ error: "Club not found" });
      }

      const dto = await mapClubRowToSummaryDTO(
        row,
        req.user.telegramId,
        req.user.isSuperadmin
      );
      if (!dto.is_admin) {
        return reply
          .code(403)
          .send({ error: "Forbidden: Club admin permission required" });
      }
      if (row.status === "blocked") {
        return reply
          .code(403)
          .send({ error: "Cannot publish to a blocked club" });
      }

      const published = await telegramBotService.publishChallengeToClub(
        row.chatId,
        req.body
      );

      return {
        ok: true,
        challenge: published,
      };
    }
  );
};

