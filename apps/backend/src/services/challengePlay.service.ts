import { and, eq } from "drizzle-orm";
import type {
  BotEngineId,
  ChallengeDiscipline,
  PlayChallengeMoveResponseDTO,
  PuzzleObjective,
  PuzzleStrategyType,
} from "shared";
import { telegramBotService } from "../bot/telegramBot.service.js";
import { db } from "../db/index.js";
import { challengeAttempts } from "../db/schema.js";
import {
  applySparringBotReplyAndResolve,
  evaluateUserChallengeMove,
  MAX_ATTEMPT_ELAPSED_MS,
} from "./attemptVerifier.service.js";
import {
  buildChallengeStateDTO,
  type ResolvedChallengeSnapshot,
} from "./challengeState.service.js";
import { engineClientService } from "./engineClient.service.js";

export class AttemptSessionError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = "AttemptSessionError";
    this.statusCode = statusCode;
  }
}

const activeAttemptLocks = new Map<string, Promise<void>>();

async function withAttemptMutex<T>(
  lockKey: string,
  task: () => Promise<T>
): Promise<T> {
  const previous = activeAttemptLocks.get(lockKey) ?? Promise.resolve();
  let release!: () => void;
  const currentGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => currentGate);
  activeAttemptLocks.set(lockKey, chained);

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (activeAttemptLocks.get(lockKey) === chained) {
      activeAttemptLocks.delete(lockKey);
    }
  }
}

function makeAttemptLockKey(params: {
  chatId: string;
  discipline: string;
  puzzleId: string;
  edition: string;
  telegramId: string;
}): string {
  return `${params.chatId}:${params.discipline}:${params.puzzleId}:${params.edition}:${params.telegramId}`;
}

export async function playChallengeMove(params: {
  chatId: string;
  discipline: ChallengeDiscipline;
  puzzleId: string;
  edition: string;
  telegramId: string;
  displayName: string;
  isSuperadmin: boolean;
  uciMove: string;
  rawMoveTimeMs?: number;
  snapshot: ResolvedChallengeSnapshot;
  onNotifyError?: (err: unknown) => void;
}): Promise<PlayChallengeMoveResponseDTO> {
  const lockKey = makeAttemptLockKey(params);

  return withAttemptMutex(lockKey, async () => {
    const [current] = await db
      .select()
      .from(challengeAttempts)
      .where(
        and(
          eq(challengeAttempts.chatId, params.chatId),
          eq(challengeAttempts.discipline, params.discipline),
          eq(challengeAttempts.puzzleId, params.puzzleId),
          eq(challengeAttempts.edition, params.edition),
          eq(challengeAttempts.telegramId, params.telegramId)
        )
      )
      .limit(1);

    if (!current) {
      throw new AttemptSessionError(
        "Challenge board session was not initialized before playing a move.",
        400
      );
    }

    if (current.status === "solved" || current.status === "surrendered") {
      throw new AttemptSessionError(
        "Challenge attempt is already finished.",
        409
      );
    }

    const row = params.snapshot.challengeRow;
    const initialEval = evaluateUserChallengeMove({
      discipline: params.discipline,
      strategy: row.strategy as PuzzleStrategyType,
      objective: row.objective as PuzzleObjective,
      userColor: row.userColor as "white" | "black",
      firstMove: row.firstMove as "bot" | "user",
      puzzleFen: row.puzzleFen,
      tacticalSolution: row.tacticalSolution,
      prevUciMoves: current.uciMoves,
      prevMoveTimesMs: current.moveTimesMs,
      userUciMove: params.uciMove,
      rawUserMoveTimeMs: params.rawMoveTimeMs,
    });

    let resolved =
      initialEval.kind === "resolved" ? initialEval : null;

    if (initialEval.kind === "needs_sparring_reply") {
      const engineReply = await engineClientService.getBestMove(
        row.botEngine as BotEngineId,
        row.puzzleFen,
        initialEval.uciList
      );
      if (!engineReply.bestMove) {
        throw new Error(
          "[ChallengePlay] Engine returned empty bestMove for non-terminal position."
        );
      }
      resolved = applySparringBotReplyAndResolve(
        initialEval,
        engineReply.bestMove
      );
    }

    if (!resolved) {
      throw new Error("[ChallengePlay] Unresolved move evaluation state.");
    }

    if (resolved.outcome === "continue") {
      // HOT-Update: touch ONLY unindexed draft columns (`uci_moves`, `move_times_ms`),
      // leaving indexed `updated_at` / `status` / `solved` untouched!
      const updatedRows = await db
        .update(challengeAttempts)
        .set({
          uciMoves: resolved.nextDraftUciMoves,
          moveTimesMs: resolved.nextDraftMoveTimesMs,
        })
        .where(
          and(
            eq(challengeAttempts.id, current.id),
            eq(challengeAttempts.status, "in_progress"),
            eq(challengeAttempts.uciMoves, current.uciMoves)
          )
        )
        .returning({ id: challengeAttempts.id });

      if (updatedRows.length === 0) {
        throw new AttemptSessionError(
          "Concurrent attempt state modification detected.",
          409
        );
      }
    } else if (
      resolved.outcome === "wrong_move" ||
      resolved.outcome === "failed_attempt"
    ) {
      const now = new Date();
      await db
        .update(challengeAttempts)
        .set({
          username: params.displayName,
          attempts: current.attempts + 1,
          uciMoves: "",
          pgnMoves: "",
          moveTimesMs: null,
          attemptStartedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(challengeAttempts.id, current.id),
            eq(challengeAttempts.status, "in_progress")
          )
        );
    } else if (resolved.outcome === "solved" && resolved.solvedPayload) {
      const now = new Date();
      const rawElapsedMs =
        now.getTime() - new Date(current.attemptStartedAt).getTime();
      const authoritativeTimeMs = Math.min(
        MAX_ATTEMPT_ELAPSED_MS,
        Math.max(200, Math.round(rawElapsedMs))
      );
      const nextAttempts = current.attempts + 1;
      const shouldNotify = !current.notifiedAt;

      await db
        .update(challengeAttempts)
        .set({
          username: params.displayName,
          status: "solved",
          solved: true,
          attempts: nextAttempts,
          solvedTimeMs: authoritativeTimeMs,
          uciMoves: resolved.solvedPayload.uciMoves,
          pgnMoves: resolved.solvedPayload.pgnMoves,
          moveTimesMs: resolved.solvedPayload.moveTimesMs,
          notifiedAt: shouldNotify ? now : current.notifiedAt,
          updatedAt: now,
          completedAt: now,
        })
        .where(
          and(
            eq(challengeAttempts.id, current.id),
            eq(challengeAttempts.status, "in_progress")
          )
        );

      await telegramBotService.checkAndResumeAutoPause(params.chatId);

      if (shouldNotify) {
        void telegramBotService
          .notifyChallengeSolved({
            chatId: params.chatId,
            discipline: params.discipline,
            puzzleId: params.puzzleId,
            edition: params.edition,
            attemptId: current.id,
            username: params.displayName,
            attempts: nextAttempts,
            timeMs: authoritativeTimeMs,
            userMovesCount: resolved.solvedPayload.userMovesCount,
            hasMoveTimings: resolved.solvedPayload.hasMoveTimings,
          })
          .catch((err) => {
            params.onNotifyError?.(err);
          });
      }
    }

    const state = await buildChallengeStateDTO({
      chatId: params.chatId,
      discipline: params.discipline,
      puzzleId: params.puzzleId,
      edition: params.edition,
      viewerTelegramId: params.telegramId,
      viewerDisplayName: params.displayName,
      viewerIsSuperadmin: params.isSuperadmin,
      canInitializeAttempt: false,
      preloadedSnapshot: params.snapshot,
    });

    return {
      outcome: resolved.outcome,
      bot_move_uci: resolved.botMoveUci,
      state,
    };
  });
}

export async function resetChallengeAttempt(params: {
  chatId: string;
  discipline: ChallengeDiscipline;
  puzzleId: string;
  edition: string;
  telegramId: string;
  displayName: string;
  isSuperadmin: boolean;
  snapshot: ResolvedChallengeSnapshot;
}) {
  const lockKey = makeAttemptLockKey(params);

  return withAttemptMutex(lockKey, async () => {
    const [current] = await db
      .select()
      .from(challengeAttempts)
      .where(
        and(
          eq(challengeAttempts.chatId, params.chatId),
          eq(challengeAttempts.discipline, params.discipline),
          eq(challengeAttempts.puzzleId, params.puzzleId),
          eq(challengeAttempts.edition, params.edition),
          eq(challengeAttempts.telegramId, params.telegramId)
        )
      )
      .limit(1);

    if (!current) {
      throw new AttemptSessionError(
        "Challenge board session was not initialized.",
        400
      );
    }

    if (
      current.status === "in_progress" &&
      current.uciMoves.trim().length > 0
    ) {
      const now = new Date();
      await db
        .update(challengeAttempts)
        .set({
          username: params.displayName,
          attempts: current.attempts + 1,
          uciMoves: "",
          pgnMoves: "",
          moveTimesMs: null,
          attemptStartedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(challengeAttempts.id, current.id),
            eq(challengeAttempts.status, "in_progress")
          )
        );
    }

    return buildChallengeStateDTO({
      chatId: params.chatId,
      discipline: params.discipline,
      puzzleId: params.puzzleId,
      edition: params.edition,
      viewerTelegramId: params.telegramId,
      viewerDisplayName: params.displayName,
      viewerIsSuperadmin: params.isSuperadmin,
      canInitializeAttempt: false,
      preloadedSnapshot: params.snapshot,
    });
  });
}
