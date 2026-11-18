import { and, eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import {
  type ChallengeDiscipline,
  type GoActiveChallengesResponseDTO,
  type PlayChallengeMoveRequest,
} from "shared";
import { telegramBotService } from "../bot/telegramBot.service.js";
import { db } from "../db/index.js";
import { challengeAttempts } from "../db/schema.js";
import { InvalidAttemptSolutionError } from "../services/attemptVerifier.service.js";
import {
  AttemptSessionError,
  playChallengeMove,
  resetChallengeAttempt,
} from "../services/challengePlay.service.js";
import {
  buildClubRecordsResponse,
  ClubNotFoundError,
  getViewerTodayActiveChallenges,
  isChallengeExpiredForViewer,
  requireExistingClub,
} from "../services/challengeQueries.service.js";
import {
  buildChallengeStateDTO,
  findChallengeAttemptRef,
  resolveChallengeSnapshot,
} from "../services/challengeState.service.js";
import {
  ClubMembershipRequiredError,
  isClubParticipantMember,
  requireClubParticipantMembership,
} from "../services/clubMembership.service.js";
import { PuzzleNotFoundError } from "../services/puzzleClient.service.js";
import {
  attemptIdParamsSchema,
  challengeParamsSchema,
  chatIdParamsSchema,
  playChallengeMoveBodySchema,
} from "./schemas.js";

interface ChallengeRouteParams {
  discipline: ChallengeDiscipline;
  puzzleId: string;
  edition: string;
  chatId: string;
}

export const challengesRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. Active today challenges across all clubs where user participates (/api/challenges/go-feed)
  fastify.get(
    "/challenges/go-feed",
    { preHandler: [fastify.authenticate] },
    async (req): Promise<GoActiveChallengesResponseDTO> => {
      const challenges = await getViewerTodayActiveChallenges({
        viewerTelegramId: req.user.telegramId,
        isSuperadmin: req.user.isSuperadmin,
      });
      return { challenges };
    }
  );

  // 1b. Resolve deep-link attempt ID (`startapp=g__<id>` / `f__<id>`) to challenge coordinates
  fastify.get<{ Params: { attemptId: string } }>(
    "/challenges/attempt-ref/:attemptId",
    {
      preHandler: [fastify.authenticate],
      schema: { params: attemptIdParamsSchema },
    },
    async (req, reply) => {
      const parsedId = Number.parseInt(req.params.attemptId, 10);
      const ref = await findChallengeAttemptRef(parsedId);
      if (!ref) {
        return reply.code(404).send({ error: "Challenge attempt not found." });
      }
      return ref;
    }
  );

  // 2. Club-wide aggregated leaderboard (/api/challenges/records/:chatId)
  fastify.get<{ Params: { chatId: string } }>(
    "/challenges/records/:chatId",
    {
      preHandler: [fastify.authenticate],
      schema: { params: chatIdParamsSchema },
    },
    async (req, reply) => {
      try {
        return await buildClubRecordsResponse({
          chatId: req.params.chatId,
          viewerTelegramId: req.user.telegramId,
          viewerIsSuperadmin: req.user.isSuperadmin,
        });
      } catch (err) {
        if (err instanceof ClubNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  // 3. Get Challenge State & Per-Puzzle Leaderboard (restores active attempt draft & server clock)
  fastify.get<{ Params: ChallengeRouteParams }>(
    "/challenges/:discipline/:puzzleId/:edition/:chatId",
    {
      preHandler: [fastify.authenticate],
      schema: { params: challengeParamsSchema },
    },
    async (req, reply) => {
      const { discipline, puzzleId, edition, chatId } = req.params;
      const safeEdition = edition || "0";
      const displayName = req.user.firstName;

      try {
        const [club, snapshot] = await Promise.all([
          requireExistingClub(chatId, {
            allowSuperadminBypass: req.user.isSuperadmin,
          }),
          resolveChallengeSnapshot({
            chatId,
            discipline,
            puzzleId,
            edition: safeEdition,
          }),
        ]);

        const expired = await isChallengeExpiredForViewer({
          chatId,
          discipline,
          puzzleId,
          edition: safeEdition,
          viewerTelegramId: req.user.telegramId,
          clubTimezone: club.timezone,
          publishedAt: snapshot.challengeRow.publishedAt,
        });
        if (expired) {
          return reply.code(410).send({
            error: "Challenge expired. Only today's challenges can be solved.",
          });
        }

        const isMember = await isClubParticipantMember({
          chatId,
          telegramId: req.user.telegramId,
          isSuperadmin: req.user.isSuperadmin,
        });

        return await buildChallengeStateDTO({
          chatId,
          discipline,
          puzzleId,
          edition: safeEdition,
          viewerTelegramId: req.user.telegramId,
          viewerDisplayName: displayName,
          viewerIsSuperadmin: req.user.isSuperadmin,
          canInitializeAttempt: isMember,
          preloadedSnapshot: snapshot,
        });
      } catch (err) {
        if (
          err instanceof ClubNotFoundError ||
          err instanceof PuzzleNotFoundError
        ) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  // 4. Server-Authoritative Move Step (validates move, checks scenario or queries `mozero`, persists draft via HOT update)
  fastify.post<{
    Params: ChallengeRouteParams;
    Body: PlayChallengeMoveRequest;
  }>(
    "/challenges/:discipline/:puzzleId/:edition/:chatId/move",
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: challengeParamsSchema,
        body: playChallengeMoveBodySchema,
      },
    },
    async (req, reply) => {
      const { discipline, puzzleId, edition, chatId } = req.params;
      const safeEdition = edition || "0";
      const displayName = req.user.firstName;

      let club;
      let snapshot;
      try {
        club = await requireExistingClub(chatId, {
          allowSuperadminBypass: req.user.isSuperadmin,
        });
        await requireClubParticipantMembership({
          chatId,
          telegramId: req.user.telegramId,
          isSuperadmin: req.user.isSuperadmin,
          languageCode: req.user.languageCode,
        });
        snapshot = await resolveChallengeSnapshot({
          chatId,
          discipline,
          puzzleId,
          edition: safeEdition,
        });
      } catch (err) {
        if (
          err instanceof ClubNotFoundError ||
          err instanceof PuzzleNotFoundError
        ) {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof ClubMembershipRequiredError) {
          return reply.code(403).send({ error: err.message });
        }
        throw err;
      }

      const expired = await isChallengeExpiredForViewer({
        chatId,
        discipline,
        puzzleId,
        edition: safeEdition,
        viewerTelegramId: req.user.telegramId,
        clubTimezone: club.timezone,
        publishedAt: snapshot.challengeRow.publishedAt,
      });
      if (expired) {
        return reply.code(410).send({
          error: "Challenge expired. Only today's challenges can be solved.",
        });
      }

      try {
        return await playChallengeMove({
          chatId,
          discipline,
          puzzleId,
          edition: safeEdition,
          telegramId: req.user.telegramId,
          displayName,
          isSuperadmin: req.user.isSuperadmin,
          uciMove: req.body.uci_move,
          rawMoveTimeMs: req.body.move_time_ms,
          snapshot,
          onNotifyError: (err) => {
            req.log.error(
              err,
              "[ChallengesRoute] Failed to send Telegram solve notification"
            );
          },
        });
      } catch (err) {
        if (
          err instanceof InvalidAttemptSolutionError ||
          err instanceof AttemptSessionError
        ) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  // 5. Explicit Attempt Reset (clears active board draft to puzzle_fen and increments `attempts + 1`)
  fastify.post<{ Params: ChallengeRouteParams }>(
    "/challenges/:discipline/:puzzleId/:edition/:chatId/reset",
    {
      preHandler: [fastify.authenticate],
      schema: { params: challengeParamsSchema },
    },
    async (req, reply) => {
      const { discipline, puzzleId, edition, chatId } = req.params;
      const safeEdition = edition || "0";
      const displayName = req.user.firstName;

      let club;
      let snapshot;
      try {
        club = await requireExistingClub(chatId, {
          allowSuperadminBypass: req.user.isSuperadmin,
        });
        await requireClubParticipantMembership({
          chatId,
          telegramId: req.user.telegramId,
          isSuperadmin: req.user.isSuperadmin,
          languageCode: req.user.languageCode,
        });
        snapshot = await resolveChallengeSnapshot({
          chatId,
          discipline,
          puzzleId,
          edition: safeEdition,
        });
      } catch (err) {
        if (
          err instanceof ClubNotFoundError ||
          err instanceof PuzzleNotFoundError
        ) {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof ClubMembershipRequiredError) {
          return reply.code(403).send({ error: err.message });
        }
        throw err;
      }

      const expired = await isChallengeExpiredForViewer({
        chatId,
        discipline,
        puzzleId,
        edition: safeEdition,
        viewerTelegramId: req.user.telegramId,
        clubTimezone: club.timezone,
        publishedAt: snapshot.challengeRow.publishedAt,
      });
      if (expired) {
        return reply.code(410).send({
          error: "Challenge expired. Only today's challenges can be solved.",
        });
      }

      try {
        return await resetChallengeAttempt({
          chatId,
          discipline,
          puzzleId,
          edition: safeEdition,
          telegramId: req.user.telegramId,
          displayName,
          isSuperadmin: req.user.isSuperadmin,
          snapshot,
        });
      } catch (err) {
        if (err instanceof AttemptSessionError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  // 6. Surrender Challenge (locks status='surrendered' and unlocks analysis & viewing others' solutions)
  fastify.post<{ Params: ChallengeRouteParams }>(
    "/challenges/:discipline/:puzzleId/:edition/:chatId/surrender",
    {
      preHandler: [fastify.authenticate],
      schema: { params: challengeParamsSchema },
    },
    async (req, reply) => {
      const { discipline, puzzleId, edition, chatId } = req.params;
      const safeEdition = edition || "0";
      const displayName = req.user.firstName;

      let club;
      let snapshot;
      try {
        club = await requireExistingClub(chatId, {
          allowSuperadminBypass: req.user.isSuperadmin,
        });
        await requireClubParticipantMembership({
          chatId,
          telegramId: req.user.telegramId,
          isSuperadmin: req.user.isSuperadmin,
          languageCode: req.user.languageCode,
        });
        snapshot = await resolveChallengeSnapshot({
          chatId,
          discipline,
          puzzleId,
          edition: safeEdition,
        });
      } catch (err) {
        if (
          err instanceof ClubNotFoundError ||
          err instanceof PuzzleNotFoundError
        ) {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof ClubMembershipRequiredError) {
          return reply.code(403).send({ error: err.message });
        }
        throw err;
      }

      const expired = await isChallengeExpiredForViewer({
        chatId,
        discipline,
        puzzleId,
        edition: safeEdition,
        viewerTelegramId: req.user.telegramId,
        clubTimezone: club.timezone,
        publishedAt: snapshot.challengeRow.publishedAt,
      });
      if (expired) {
        return reply.code(410).send({
          error: "Challenge expired. Only today's challenges can be solved.",
        });
      }

      await db
        .insert(challengeAttempts)
        .values({
          chatId,
          discipline,
          puzzleId,
          edition: safeEdition,
          telegramId: req.user.telegramId,
          username: displayName,
          status: "surrendered",
          solved: false,
          attempts: 1,
          completedAt: new Date(),
        })
        .onConflictDoNothing();

      const [current] = await db
        .select()
        .from(challengeAttempts)
        .where(
          and(
            eq(challengeAttempts.chatId, chatId),
            eq(challengeAttempts.discipline, discipline),
            eq(challengeAttempts.puzzleId, puzzleId),
            eq(challengeAttempts.edition, safeEdition),
            eq(challengeAttempts.telegramId, req.user.telegramId)
          )
        )
        .limit(1);

      if (current && current.status === "in_progress") {
        await db
          .update(challengeAttempts)
          .set({
            status: "surrendered",
            attempts: Math.max(1, current.attempts),
            uciMoves: "",
            pgnMoves: "",
            moveTimesMs: null,
            updatedAt: new Date(),
            completedAt: new Date(),
          })
          .where(eq(challengeAttempts.id, current.id));
      }

      await telegramBotService.checkAndResumeAutoPause(chatId);

      return buildChallengeStateDTO({
        chatId,
        discipline,
        puzzleId,
        edition: safeEdition,
        viewerTelegramId: req.user.telegramId,
        viewerDisplayName: displayName,
        viewerIsSuperadmin: req.user.isSuperadmin,
        canInitializeAttempt: false,
        preloadedSnapshot: snapshot,
      });
    }
  );
};
