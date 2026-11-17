import { eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import {
  ALL_DAYS_OF_WEEK,
  normalizeWeeklySchedule,
  type ChallengeDifficulty,
  type ChallengeDiscipline,
  type ClubsCompetitionResponseDTO,
  type UpdateClubSettingsRequest,
} from "shared";
import { telegramBotService } from "../bot/telegramBot.service.js";
import { db } from "../db/index.js";
import {
  challengeAttempts,
  clubAdmins,
  clubChallenges,
  clubs,
} from "../db/schema.js";
import { buildClubsCompetitionLeaderboard } from "../services/clubLeaderboard.service.js";
import { mapClubRowToSummaryDTO } from "../services/clubMapper.js";
import {
  getClubRouteErrors,
  validateWeeklyScheduleIntervals,
} from "../services/clubSettings.service.js";
import {
  chatIdParamsSchema,
  onboardingLanguageBodySchema,
  publishNowBodySchema,
  toggleClubActiveBodySchema,
  updateClubSettingsBodySchema,
} from "./schemas.js";

export const clubsRoutes: FastifyPluginAsync = async (fastify) => {
  // Pre-registers the mandatory group language (EN / DE / RU) chosen by an admin before adding @ExtraPawnTeleBot
  fastify.post<{ Body: { language: string } }>(
    "/clubs/onboarding-language",
    {
      preHandler: [fastify.authenticate],
      schema: { body: onboardingLanguageBodySchema },
    },
    async (req, reply) => {
      const lang = req.body.language;
      if (lang !== "en" && lang !== "de" && lang !== "ru") {
        const msg = getClubRouteErrors(req.user.languageCode).invalidLanguage;
        return reply.code(400).send({ error: msg });
      }
      telegramBotService.setPendingOnboardingLanguage(
        req.user.telegramId,
        lang
      );
      return { ok: true, language: lang };
    }
  );

  // Inter-Club 7-Day Competition Leaderboard (/api/clubs/leaderboard)
  fastify.get(
    "/clubs/leaderboard",
    { preHandler: [fastify.authenticate] },
    async (req): Promise<ClubsCompetitionResponseDTO> =>
      buildClubsCompetitionLeaderboard({
        viewerTelegramId: req.user.telegramId,
        viewerIsSuperadmin: req.user.isSuperadmin,
      })
  );

  fastify.get<{ Params: { chatId: string } }>(
    "/clubs/:chatId",
    {
      preHandler: [fastify.authenticate],
      schema: { params: chatIdParamsSchema },
    },
    async (req, reply) => {
      const [row] = await db
        .select()
        .from(clubs)
        .where(eq(clubs.chatId, req.params.chatId))
        .limit(1);

      if (!row) {
        return reply
          .code(404)
          .send({ error: getClubRouteErrors(req.user.languageCode).notFound });
      }

      if (
        !req.user.isSuperadmin &&
        row.status !== "blocked" &&
        row.status !== "bot_removed"
      ) {
        await telegramBotService.verifyLiveClubManager(
          row.chatId,
          req.user.telegramId,
          { forceFresh: false }
        );
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
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: chatIdParamsSchema,
        body: toggleClubActiveBodySchema,
      },
    },
    async (req, reply) => {
      const [row] = await db
        .select()
        .from(clubs)
        .where(eq(clubs.chatId, req.params.chatId))
        .limit(1);

      const errs = getClubRouteErrors(req.user.languageCode);

      if (!row) {
        return reply.code(404).send({ error: errs.notFound });
      }

      const canManage =
        req.user.isSuperadmin ||
        (await telegramBotService.verifyLiveClubManager(
          row.chatId,
          req.user.telegramId,
          { forceFresh: true }
        ));
      if (!canManage) {
        return reply.code(403).send({
          error: errs.forbiddenManager,
        });
      }
      if (row.status === "blocked" && !req.user.isSuperadmin) {
        return reply.code(403).send({ error: errs.blockedClub });
      }
      if (row.status === "pending" && !req.user.isSuperadmin) {
        return reply.code(403).send({ error: errs.pendingApproval });
      }
      if (row.status === "bot_removed") {
        return reply.code(403).send({
          error: errs.botRemoved,
        });
      }

      const nextIsActive = Boolean(req.body.is_active);
      if (nextIsActive) {
        const botRights = await telegramBotService.verifyBotHasClubPermissions(
          row.chatId,
          req.user.languageCode
        );
        if (!botRights.ok) {
          return reply.code(403).send({ error: botRights.reason });
        }
      }
      const nextStatus =
        row.status === "blocked" && !req.user.isSuperadmin
          ? "blocked"
          : nextIsActive
            ? "active"
            : "paused";

      await telegramBotService.clearAutoPause(req.params.chatId);

      const [updated] = await db
        .update(clubs)
        .set({
          isActive: nextIsActive,
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(clubs.chatId, req.params.chatId))
        .returning();

      void telegramBotService
        .notifyClubSettingsUpdated({
          chatId: req.params.chatId,
          firstName: req.user.firstName,
        })
        .catch((err) => {
          req.log.error(
            err,
            "[ClubsRoute] Failed to send Telegram active toggle notification"
          );
        });

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
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: chatIdParamsSchema,
        body: updateClubSettingsBodySchema,
      },
    },
    async (req, reply) => {
      const [row] = await db
        .select()
        .from(clubs)
        .where(eq(clubs.chatId, req.params.chatId))
        .limit(1);

      const errs = getClubRouteErrors(req.user.languageCode);

      if (!row) {
        return reply.code(404).send({ error: errs.notFound });
      }

      const canManage =
        req.user.isSuperadmin ||
        (await telegramBotService.verifyLiveClubManager(
          row.chatId,
          req.user.telegramId,
          { forceFresh: true }
        ));

      if (!canManage) {
        return reply.code(403).send({
          error: errs.forbiddenManager,
        });
      }

      if (row.status === "blocked" && !req.user.isSuperadmin) {
        return reply.code(403).send({ error: errs.blockedClub });
      }
      if (row.status === "bot_removed") {
        return reply.code(403).send({
          error: errs.botRemoved,
        });
      }

      const body = req.body;
      const weeklySchedule = normalizeWeeklySchedule(
        body.weekly_schedule ?? row.weeklySchedule
      );

      const scheduleError = validateWeeklyScheduleIntervals(
        weeklySchedule,
        errs
      );
      if (scheduleError) {
        return reply.code(400).send({ error: scheduleError });
      }

      const isPendingModeration =
        row.status === "pending" && !req.user.isSuperadmin;

      const nextIsActive = isPendingModeration
        ? false
        : typeof body.is_active === "boolean"
          ? body.is_active
          : Boolean(row.isActive);

      if (nextIsActive) {
        const botRights = await telegramBotService.verifyBotHasClubPermissions(
          row.chatId,
          req.user.languageCode
        );
        if (!botRights.ok) {
          return reply.code(403).send({ error: botRights.reason });
        }
      }

      const nextStatus =
        row.status === "blocked" && !req.user.isSuperadmin
          ? "blocked"
          : isPendingModeration
            ? "pending"
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

      if (!isPendingModeration) {
        void telegramBotService
          .notifyClubSettingsUpdated({
            chatId: req.params.chatId,
            firstName: req.user.firstName,
          })
          .catch((err) => {
            req.log.error(
              err,
              "[ClubsRoute] Failed to send Telegram settings notification"
            );
          });
      }

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
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: chatIdParamsSchema,
        body: publishNowBodySchema,
      },
    },
    async (req, reply) => {
      const [row] = await db
        .select()
        .from(clubs)
        .where(eq(clubs.chatId, req.params.chatId))
        .limit(1);

      const errs = getClubRouteErrors(req.user.languageCode);

      if (!row) {
        return reply.code(404).send({ error: errs.notFound });
      }

      const canManage =
        req.user.isSuperadmin ||
        (await telegramBotService.verifyLiveClubManager(
          row.chatId,
          req.user.telegramId,
          { forceFresh: true }
        ));
      if (!canManage) {
        return reply.code(403).send({
          error: errs.forbiddenManager,
        });
      }
      if (row.status === "blocked") {
        return reply.code(403).send({ error: errs.blockedClub });
      }
      if (row.status === "pending" && !req.user.isSuperadmin) {
        return reply.code(403).send({ error: errs.pendingApproval });
      }
      if (row.status === "bot_removed") {
        return reply.code(403).send({
          error: errs.botRemoved,
        });
      }

      const botRights = await telegramBotService.verifyBotHasClubPermissions(
        row.chatId,
        req.user.languageCode
      );
      if (!botRights.ok) {
        return reply.code(403).send({ error: botRights.reason });
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

  // SuperAdmin ONLY: disconnect & purge all club data from PostgreSQL
  fastify.delete<{ Params: { chatId: string } }>(
    "/clubs/:chatId",
    {
      preHandler: [fastify.requireSuperadmin],
      schema: { params: chatIdParamsSchema },
    },
    async (req, reply) => {
      const { chatId } = req.params;
      const [row] = await db
        .select()
        .from(clubs)
        .where(eq(clubs.chatId, chatId))
        .limit(1);

      if (!row) {
        return reply
          .code(404)
          .send({ error: getClubRouteErrors(req.user.languageCode).notFound });
      }

      await db
        .delete(challengeAttempts)
        .where(eq(challengeAttempts.chatId, chatId));
      await db
        .delete(clubChallenges)
        .where(eq(clubChallenges.chatId, chatId));

      // If blacklisted by SuperAdmin, purge all activity & admins while preserving the blacklist entry
      if (row.status === "blocked") {
        await telegramBotService.clearAutoPause(chatId);
        await db.delete(clubAdmins).where(eq(clubAdmins.chatId, chatId));
        await db
          .update(clubs)
          .set({
            memberCount: 0,
            topicMessageIds: [],
            lastPublishedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(clubs.chatId, chatId));
        return { ok: true, deleted_club_row: false };
      }

      await telegramBotService.leaveClubChat(chatId);
      await db.delete(clubs).where(eq(clubs.chatId, chatId));

      return { ok: true, deleted_club_row: true };
    }
  );
};
