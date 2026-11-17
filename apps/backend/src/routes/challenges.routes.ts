import { and, eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import {
  type ChallengeAttemptStatus,
  type ChallengeDiscipline,
  type GoActiveChallengesResponseDTO,
  type PuzzleObjective,
  type PuzzleStrategyType,
  type SubmitChallengeAttemptRequest,
} from "shared";
import { telegramBotService } from "../bot/telegramBot.service.js";
import { db } from "../db/index.js";
import { challengeAttempts } from "../db/schema.js";
import {
  InvalidAttemptSolutionError,
  verifyAndSanitizeSolvedAttempt,
} from "../services/attemptVerifier.service.js";
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
  submitAttemptBodySchema,
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

  // 3. Get Challenge State & Per-Puzzle Leaderboard
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
        const club = await requireExistingClub(chatId, {
          allowSuperadminBypass: req.user.isSuperadmin,
        });

        const expired = await isChallengeExpiredForViewer({
          chatId,
          discipline,
          puzzleId,
          edition: safeEdition,
          viewerTelegramId: req.user.telegramId,
          clubTimezone: club.timezone,
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

  // 4. Submit Challenge Attempt (wrong move or verified solved completion)
  fastify.post<{
    Params: ChallengeRouteParams;
    Body: SubmitChallengeAttemptRequest;
  }>(
    "/challenges/:discipline/:puzzleId/:edition/:chatId/attempt",
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: challengeParamsSchema,
        body: submitAttemptBodySchema,
      },
    },
    async (req, reply) => {
      const { discipline, puzzleId, edition, chatId } = req.params;
      const safeEdition = edition || "0";
      const displayName = req.user.firstName;
      const { solved, time_ms, uci_moves = "", move_times_ms } = req.body;

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
      });
      if (expired) {
        return reply.code(410).send({
          error: "Challenge expired. Only today's challenges can be solved.",
        });
      }

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

      if (!current) {
        return reply.code(400).send({
          error: "Challenge board session was not initialized before submission.",
        });
      }

      if (current.status !== "solved" && current.status !== "surrendered") {
        let verifiedMoves = null;
        if (solved) {
          try {
            verifiedMoves = verifyAndSanitizeSolvedAttempt({
              discipline,
              strategy: snapshot.challengeRow.strategy as PuzzleStrategyType,
              objective: snapshot.challengeRow.objective as PuzzleObjective,
              userColor: snapshot.challengeRow.userColor as "white" | "black",
              firstMove: snapshot.challengeRow.firstMove as "bot" | "user",
              puzzleFen: snapshot.challengeRow.puzzleFen,
              tacticalSolution: snapshot.challengeRow.tacticalSolution,
              rawUciMoves: uci_moves,
              rawMoveTimesMs: move_times_ms,
            });
          } catch (err) {
            if (err instanceof InvalidAttemptSolutionError) {
              return reply.code(400).send({ error: err.message });
            }
            throw err;
          }
        }

        const nextAttempts = current.attempts + 1;
        const nextStatus: ChallengeAttemptStatus = solved
          ? "solved"
          : "in_progress";
        const shouldNotify = solved && !current.notifiedAt;
        const clampedTimeMs = Math.max(0, Math.round(time_ms));

        await db
          .update(challengeAttempts)
          .set({
            username: displayName,
            status: nextStatus,
            solved: solved ? true : current.solved,
            attempts: nextAttempts,
            solvedTimeMs: solved ? clampedTimeMs : null,
            uciMoves: verifiedMoves ? verifiedMoves.uciMoves : current.uciMoves,
            pgnMoves: verifiedMoves ? verifiedMoves.pgnMoves : current.pgnMoves,
            moveTimesMs: verifiedMoves
              ? verifiedMoves.moveTimesMs
              : current.moveTimesMs,
            notifiedAt: shouldNotify ? new Date() : current.notifiedAt,
            updatedAt: new Date(),
            completedAt: solved ? new Date() : null,
          })
          .where(eq(challengeAttempts.id, current.id));

        if (solved) {
          await telegramBotService.checkAndResumeAutoPause(chatId);
        }

        if (shouldNotify && verifiedMoves) {
          void telegramBotService
            .notifyChallengeSolved({
              chatId,
              discipline,
              puzzleId,
              edition: safeEdition,
              attemptId: current.id,
              username: req.user.firstName,
              attempts: nextAttempts,
              timeMs: clampedTimeMs,
              userMovesCount: verifiedMoves.userMovesCount,
              hasMoveTimings: verifiedMoves.hasMoveTimings,
            })
            .catch((err) => {
              req.log.error(
                err,
                "[ChallengesRoute] Failed to send Telegram solve notification"
              );
            });
        }
      }

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

  // 5. Surrender Challenge (locks status='surrendered' and unlocks analysis & viewing others' solutions)
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
