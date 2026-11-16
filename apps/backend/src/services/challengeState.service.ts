import { and, eq } from "drizzle-orm";
import {
  calculateAttemptPoints,
  roundPoints,
  type BotEngineId,
  type ChallengeAttemptRefDTO,
  type ChallengeAttemptStatus,
  type ChallengeDifficulty,
  type ChallengeDiscipline,
  type ChallengeParticipantDTO,
  type ChallengeStateDTO,
  type PuzzleObjective,
  type PuzzleStrategyType,
} from "shared";
import { db } from "../db/index.js";
import { challengeAttempts, clubChallenges, users } from "../db/schema.js";
import {
  computeViewerNextActive,
  ensureClubExists,
} from "./challengeQueries.service.js";
import {
  puzzleClientService,
  type NormalizedChallengePuzzle,
} from "./puzzleClient.service.js";

const MIN_MOVE_TIME_MS = 50;
const MAX_MOVE_TIME_MS = 10_000;

export interface SanitizedSolvedMoves {
  uciMoves: string;
  pgnMoves: string;
  moveTimesMs: number[] | null;
  userMovesCount: number;
  hasMoveTimings: boolean;
}

/**
 * Enforces domain rules for storing move history:
 * - For `tactics`, move history is NOT stored (`""`, `null`), because all solutions follow the same script.
 * - For non-tactics (`theoretical_endgames`, `practical_chess`, `finishhim`), stores `uci_moves`,
 *   `pgn_moves`, and per-ply `move_times_ms` clamped to `[50..10_000]` ms.
 */
export function sanitizeSolvedAttemptMoves(params: {
  discipline: ChallengeDiscipline;
  rawUciMoves?: string;
  rawPgnMoves?: string;
  rawMoveTimesMs?: number[];
}): SanitizedSolvedMoves {
  if (params.discipline === "tactics") {
    return {
      uciMoves: "",
      pgnMoves: "",
      moveTimesMs: null,
      userMovesCount: 0,
      hasMoveTimings: false,
    };
  }

  const uciList = (params.rawUciMoves ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const uciMoves = uciList.join(" ");
  const pgnMoves = (params.rawPgnMoves ?? "").trim();
  const userMovesCount = Math.ceil(uciList.length / 2);

  let moveTimesMs: number[] | null = null;
  if (
    uciList.length > 0 &&
    Array.isArray(params.rawMoveTimesMs) &&
    params.rawMoveTimesMs.length === uciList.length
  ) {
    moveTimesMs = params.rawMoveTimesMs.map((raw) => {
      const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 250;
      return Math.min(MAX_MOVE_TIME_MS, Math.max(MIN_MOVE_TIME_MS, Math.round(n)));
    });
  }

  return {
    uciMoves,
    pgnMoves,
    moveTimesMs,
    userMovesCount,
    hasMoveTimings: moveTimesMs !== null,
  };
}

export async function findChallengeAttemptRef(
  attemptId: number
): Promise<ChallengeAttemptRefDTO | null> {
  if (!Number.isFinite(attemptId) || attemptId <= 0) {
    return null;
  }

  const [row] = await db
    .select({
      id: challengeAttempts.id,
      discipline: challengeAttempts.discipline,
      puzzleId: challengeAttempts.puzzleId,
      edition: challengeAttempts.edition,
      chatId: challengeAttempts.chatId,
      telegramId: challengeAttempts.telegramId,
    })
    .from(challengeAttempts)
    .where(eq(challengeAttempts.id, Math.trunc(attemptId)))
    .limit(1);

  if (!row) return null;

  return {
    attempt_id: row.id,
    discipline: row.discipline as ChallengeDiscipline,
    puzzle_id: row.puzzleId,
    edition: row.edition,
    chat_id: row.chatId,
    telegram_id: row.telegramId,
  };
}

export type ClubChallengeRow = typeof clubChallenges.$inferSelect;

export interface ResolvedChallengeSnapshot {
  challengeRow: ClubChallengeRow;
  normalized?: NormalizedChallengePuzzle;
}

/**
 * Snapshot-First lookup: published challenges in `tele_app.club_challenges` already hold
 * the complete immutable board & solution snapshot, so they resolve in 0 HTTP calls
 * and remain 100% playable even if `puzzle_service` rotates its CSV catalog.
 */
export async function resolveChallengeSnapshot(params: {
  chatId: string;
  discipline: ChallengeDiscipline;
  puzzleId: string;
  edition: string;
}): Promise<ResolvedChallengeSnapshot> {
  const [existing] = await db
    .select()
    .from(clubChallenges)
    .where(
      and(
        eq(clubChallenges.chatId, params.chatId),
        eq(clubChallenges.discipline, params.discipline),
        eq(clubChallenges.puzzleId, params.puzzleId),
        eq(clubChallenges.edition, params.edition)
      )
    )
    .limit(1);

  if (existing) {
    if (!existing.initialFen || !existing.puzzleFen) {
      throw new Error(
        `[ChallengeState] Corrupt snapshot in club_challenges id=${existing.id}: missing FEN`
      );
    }
    return { challengeRow: existing };
  }

  const normalized = await puzzleClientService.getPuzzleById(
    params.discipline,
    params.puzzleId
  );

  const [inserted] = await db
    .insert(clubChallenges)
    .values({
      chatId: params.chatId,
      discipline: params.discipline,
      puzzleId: params.puzzleId,
      edition: params.edition,
      difficulty: normalized.difficulty,
      botEngine: normalized.botEngine,
      initialFen: normalized.initialFen,
      puzzleFen: normalized.puzzleFen,
      userColor: normalized.userColor,
      firstMove: normalized.firstMove,
      strategy: normalized.strategy,
      objective: normalized.objective,
      tacticalSolution: normalized.tacticalSolution,
      domain: normalized.domain,
      category: normalized.category,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    return { challengeRow: inserted, normalized };
  }

  const [refetched] = await db
    .select()
    .from(clubChallenges)
    .where(
      and(
        eq(clubChallenges.chatId, params.chatId),
        eq(clubChallenges.discipline, params.discipline),
        eq(clubChallenges.puzzleId, params.puzzleId),
        eq(clubChallenges.edition, params.edition)
      )
    )
    .limit(1);

  if (!refetched) {
    throw new Error(
      `[ChallengeState] Failed to persist challenge snapshot for ${params.discipline}/${params.puzzleId}`
    );
  }

  return { challengeRow: refetched, normalized };
}

export async function buildChallengeStateDTO(params: {
  chatId: string;
  discipline: ChallengeDiscipline;
  puzzleId: string;
  edition: string;
  viewerTelegramId: string;
  viewerDisplayName: string;
  viewerIsSuperadmin: boolean;
  preloadedSnapshot?: ResolvedChallengeSnapshot;
}): Promise<ChallengeStateDTO> {
  const club = await ensureClubExists(params.chatId);

  const { challengeRow, normalized } =
    params.preloadedSnapshot ??
    (await resolveChallengeSnapshot({
      chatId: params.chatId,
      discipline: params.discipline,
      puzzleId: params.puzzleId,
      edition: params.edition,
    }));

  await db
    .insert(challengeAttempts)
    .values({
      chatId: params.chatId,
      discipline: params.discipline,
      puzzleId: params.puzzleId,
      edition: params.edition,
      telegramId: params.viewerTelegramId,
      username: params.viewerDisplayName,
      status: "in_progress",
      solved: false,
      attempts: 0,
    })
    .onConflictDoNothing();

  const rows = await db
    .select({
      attempt: challengeAttempts,
      user: users,
    })
    .from(challengeAttempts)
    .leftJoin(users, eq(challengeAttempts.telegramId, users.telegramId))
    .where(
      and(
        eq(challengeAttempts.chatId, params.chatId),
        eq(challengeAttempts.discipline, params.discipline),
        eq(challengeAttempts.puzzleId, params.puzzleId),
        eq(challengeAttempts.edition, params.edition)
      )
    );

  rows.sort((a, b) => {
    if (a.attempt.solved !== b.attempt.solved) {
      return a.attempt.solved ? -1 : 1;
    }
    if (a.attempt.solved && b.attempt.solved) {
      if (a.attempt.attempts !== b.attempt.attempts) {
        return a.attempt.attempts - b.attempt.attempts;
      }
      const timeA = a.attempt.solvedTimeMs ?? Number.MAX_SAFE_INTEGER;
      const timeB = b.attempt.solvedTimeMs ?? Number.MAX_SAFE_INTEGER;
      if (timeA !== timeB) {
        return timeA - timeB;
      }
    }
    if (a.attempt.attempts !== b.attempt.attempts) {
      return b.attempt.attempts - a.attempt.attempts;
    }
    return (
      new Date(a.attempt.updatedAt).getTime() -
      new Date(b.attempt.updatedAt).getTime()
    );
  });

  const viewerAttempt = rows.find(
    (r) => r.attempt.telegramId === params.viewerTelegramId
  )?.attempt;

  const canRevealOtherSolutions =
    viewerAttempt?.status === "solved" ||
    viewerAttempt?.status === "surrendered";

  const isTactics = params.discipline === "tactics";

  const leaderboard: ChallengeParticipantDTO[] = rows.map((r, idx) => {
    const att = r.attempt;
    const usr = r.user;
    const isViewer = att.telegramId === params.viewerTelegramId;
    const points = roundPoints(
      calculateAttemptPoints(att.solved, att.attempts)
    );
    const scorePoints = att.solved ? 1 : 0;
    const denom = att.solved && att.attempts === 0 ? 1 : att.attempts;
    const scoreText = `${scorePoints}/${denom}`;
    const displayName = usr?.firstName || att.username;

    const canSeeMoves = !isTactics && (canRevealOtherSolutions || isViewer);
    const uciCount = canSeeMoves
      ? att.uciMoves.trim().split(/\s+/).filter(Boolean).length
      : 0;
    const validTimings =
      canSeeMoves &&
      Array.isArray(att.moveTimesMs) &&
      att.moveTimesMs.length === uciCount &&
      uciCount > 0
        ? att.moveTimesMs
        : null;

    return {
      rank: idx + 1,
      telegram_id: att.telegramId,
      username: att.username,
      display_name: displayName,
      avatar_url: usr?.avatarUrl ?? null,
      status: (att.status || "in_progress") as ChallengeAttemptStatus,
      solved: att.solved,
      attempts: att.attempts,
      points,
      score_text: scoreText,
      solved_time_ms: att.solvedTimeMs ?? null,
      uci_moves: canSeeMoves ? att.uciMoves : "",
      pgn_moves: canSeeMoves ? att.pgnMoves : "",
      move_times_ms: validTimings,
      updated_at: att.updatedAt.toISOString(),
      completed_at: att.completedAt ? att.completedAt.toISOString() : null,
    };
  });

  const myEntry =
    leaderboard.find((p) => p.telegram_id === params.viewerTelegramId) ?? null;

  const nextActiveInfo = await computeViewerNextActive({
    chatId: params.chatId,
    viewerTelegramId: params.viewerTelegramId,
    viewerIsSuperadmin: params.viewerIsSuperadmin,
    exclude: {
      discipline: params.discipline,
      puzzleId: params.puzzleId,
      edition: params.edition,
    },
  });

  return {
    chat_id: params.chatId,
    club_title: club.title,
    discipline: params.discipline,
    puzzle_id: params.puzzleId,
    edition: params.edition,
    difficulty: challengeRow.difficulty as ChallengeDifficulty,
    bot_engine: challengeRow.botEngine as BotEngineId,
    initial_fen: challengeRow.initialFen,
    puzzle_fen: challengeRow.puzzleFen,
    user_color: challengeRow.userColor as "white" | "black",
    first_move: challengeRow.firstMove as "bot" | "user",
    strategy: challengeRow.strategy as PuzzleStrategyType,
    objective: challengeRow.objective as PuzzleObjective,
    tactical_solution: challengeRow.tacticalSolution,
    domain: challengeRow.domain,
    category: challengeRow.category,
    tactical: normalized?.tactical,
    endgame: normalized?.endgame,
    my_entry: myEntry,
    leaderboard,
    remaining_active_count: nextActiveInfo.remainingActiveCount,
    next_active_challenge: nextActiveInfo.nextActiveChallenge,
  };
}
