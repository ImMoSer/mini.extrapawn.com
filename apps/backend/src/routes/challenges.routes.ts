import { and, eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import {
  type ChallengeAttemptStatus,
  type ChallengeDiscipline,
  type GoActiveChallengesResponseDTO,
  type SubmitChallengeAttemptRequest,
} from "shared";
import { telegramBotService } from "../bot/telegramBot.service.js";
import { db } from "../db/index.js";
import { challengeAttempts } from "../db/schema.js";
import { renderBoardPng } from "../services/boardImage.service.js";
import {
  buildClubRecordsResponse,
  ensureClubExists,
  getViewerTodayActiveChallenges,
  isChallengeExpiredForViewer,
} from "../services/challengeQueries.service.js";
import {
  buildChallengeStateDTO,
  findChallengeAttemptRef,
  sanitizeSolvedAttemptMoves,
} from "../services/challengeState.service.js";

interface ChallengeRouteParams {
  discipline: ChallengeDiscipline;
  puzzleId: string;
  edition: string;
  chatId: string;
}

export const challengesRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. Dynamic board.png generator
  fastify.get<{
    Querystring: {
      fen: string;
      orientation?: "white" | "black";
      lastMove?: string;
    };
  }>("/challenges/board-png", async (req, reply) => {
    const fen = req.query.fen?.trim();
    if (!fen) {
      return reply.code(400).send({ error: "Missing 'fen' query parameter" });
    }
    const orientation =
      req.query.orientation === "black" ? "black" : "white";
    const png = renderBoardPng({
      fen,
      orientation,
      lastMoveUci: req.query.lastMove?.trim(),
    });
    return reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", "public, max-age=86400")
      .send(png);
  });

  // 1b. Active today challenges across all clubs where user participates (/api/challenges/go-feed)
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

  // 1c. Resolve deep-link attempt ID (`startapp=g__<id>` / `f__<id>`) to challenge coordinates
  fastify.get<{ Params: { attemptId: string } }>(
    "/challenges/attempt-ref/:attemptId",
    { preHandler: [fastify.authenticate] },
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
    { preHandler: [fastify.authenticate] },
    async (req) =>
      buildClubRecordsResponse({
        chatId: req.params.chatId,
        viewerTelegramId: req.user.telegramId,
        viewerIsSuperadmin: req.user.isSuperadmin,
      })
  );

  // 3. Get Challenge State & Per-Puzzle Leaderboard
  fastify.get<{ Params: ChallengeRouteParams }>(
    "/challenges/:discipline/:puzzleId/:edition/:chatId",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const { discipline, puzzleId, edition, chatId } = req.params;
      const safeEdition = edition || "0";
      const displayName = req.user.firstName;
      const club = await ensureClubExists(chatId);

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

      return buildChallengeStateDTO({
        chatId,
        discipline,
        puzzleId,
        edition: safeEdition,
        viewerTelegramId: req.user.telegramId,
        viewerDisplayName: displayName,
        viewerIsSuperadmin: req.user.isSuperadmin,
      });
    }
  );

  // 4. Submit Challenge Attempt (wrong move or solved completion)
  fastify.post<{
    Params: ChallengeRouteParams;
    Body: SubmitChallengeAttemptRequest;
  }>(
    "/challenges/:discipline/:puzzleId/:edition/:chatId/attempt",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const { discipline, puzzleId, edition, chatId } = req.params;
      const safeEdition = edition || "0";
      const displayName = req.user.firstName;
      const {
        solved,
        time_ms,
        uci_moves = "",
        pgn_moves = "",
        move_times_ms,
      } = req.body;

      const club = await ensureClubExists(chatId);
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
          status: "in_progress",
          solved: false,
          attempts: 0,
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

      if (
        current &&
        current.status !== "solved" &&
        current.status !== "surrendered"
      ) {
        const nextAttempts = current.attempts + 1;
        const nextStatus: ChallengeAttemptStatus = solved
          ? "solved"
          : "in_progress";
        const shouldNotify = solved && !current.notifiedAt;

        const sanitized = solved
          ? sanitizeSolvedAttemptMoves({
              discipline,
              rawUciMoves: uci_moves,
              rawPgnMoves: pgn_moves,
              rawMoveTimesMs: move_times_ms,
            })
          : null;

        await db
          .update(challengeAttempts)
          .set({
            username: displayName,
            status: nextStatus,
            solved: solved ? true : current.solved,
            attempts: nextAttempts,
            solvedTimeMs: solved ? Math.max(0, Math.round(time_ms)) : null,
            uciMoves: sanitized ? sanitized.uciMoves : current.uciMoves,
            pgnMoves: sanitized ? sanitized.pgnMoves : current.pgnMoves,
            moveTimesMs: sanitized ? sanitized.moveTimesMs : current.moveTimesMs,
            notifiedAt: shouldNotify ? new Date() : current.notifiedAt,
            updatedAt: new Date(),
            completedAt: solved ? new Date() : null,
          })
          .where(eq(challengeAttempts.id, current.id));

        if (solved) {
          await telegramBotService.checkAndResumeAutoPause(chatId);
        }

        if (shouldNotify && sanitized) {
          void telegramBotService
            .notifyChallengeSolved({
              chatId,
              discipline,
              puzzleId,
              edition: safeEdition,
              attemptId: current.id,
              username: req.user.firstName,
              attempts: nextAttempts,
              timeMs: Math.max(0, Math.round(time_ms)),
              userMovesCount: sanitized.userMovesCount,
              hasMoveTimings: sanitized.hasMoveTimings,
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
      });
    }
  );

  // 5. Surrender Challenge (locks status='surrendered' and unlocks analysis & viewing others' solutions)
  fastify.post<{ Params: ChallengeRouteParams }>(
    "/challenges/:discipline/:puzzleId/:edition/:chatId/surrender",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const { discipline, puzzleId, edition, chatId } = req.params;
      const safeEdition = edition || "0";
      const displayName = req.user.firstName;

      const club = await ensureClubExists(chatId);
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
      });
    }
  );
};
