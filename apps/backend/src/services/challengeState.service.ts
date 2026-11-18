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
import { MAX_ATTEMPT_ELAPSED_MS } from "./attemptVerifier.service.js";
import {
  computeViewerNextActive,
  requireExistingClub,
} from "./challengeQueries.service.js";
import {
  PuzzleNotFoundError,
  type NormalizedChallengePuzzle,
} from "./puzzleClient.service.js";

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

const SNAPSHOT_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_SNAPSHOT_CACHE_SIZE = 500;
const snapshotCache = new Map<
  string,
  { snapshot: ResolvedChallengeSnapshot; expiresAt: number }
>();

/**
 * Snapshot-First lookup with bounded in-memory TTL cache: published challenges in
 * `tele_app.club_challenges` hold an immutable board & solution snapshot, resolving
 * in 0 SQL / 0 HTTP calls on warm hits during rapid sparring moves.
 */
export async function resolveChallengeSnapshot(params: {
  chatId: string;
  discipline: ChallengeDiscipline;
  puzzleId: string;
  edition: string;
}): Promise<ResolvedChallengeSnapshot> {
  const cacheKey = `${params.chatId}:${params.discipline}:${params.puzzleId}:${params.edition}`;
  const nowMs = Date.now();
  const cached = snapshotCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) {
    return cached.snapshot;
  }

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
    if (snapshotCache.size >= MAX_SNAPSHOT_CACHE_SIZE) {
      const oldestKey = snapshotCache.keys().next().value;
      if (oldestKey) snapshotCache.delete(oldestKey);
    }
    const resolved: ResolvedChallengeSnapshot = { challengeRow: existing };
    snapshotCache.set(cacheKey, {
      snapshot: resolved,
      expiresAt: nowMs + SNAPSHOT_CACHE_TTL_MS,
    });
    return resolved;
  }

  throw new PuzzleNotFoundError(params.discipline, params.puzzleId);
}

export async function buildChallengeStateDTO(params: {
  chatId: string;
  discipline: ChallengeDiscipline;
  puzzleId: string;
  edition: string;
  viewerTelegramId: string;
  viewerDisplayName: string;
  viewerIsSuperadmin: boolean;
  canInitializeAttempt?: boolean;
  preloadedSnapshot?: ResolvedChallengeSnapshot;
}): Promise<ChallengeStateDTO> {
  const club = await requireExistingClub(params.chatId, {
    allowSuperadminBypass: params.viewerIsSuperadmin,
  });

  const { challengeRow, normalized } =
    params.preloadedSnapshot ??
    (await resolveChallengeSnapshot({
      chatId: params.chatId,
      discipline: params.discipline,
      puzzleId: params.puzzleId,
      edition: params.edition,
    }));

  if (params.canInitializeAttempt !== false) {
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
  }

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

  const canRevealSolutions =
    viewerAttempt?.status === "solved" ||
    viewerAttempt?.status === "surrendered";

  const isTactics = params.discipline === "tactics";
  const nowMs = Date.now();

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

    // 1. Viewer's own unfinished attempt: expose draft `uci_moves` + `move_times_ms` + server `elapsed_ms` for resume
    const isViewerActiveDraft = isViewer && att.status === "in_progress";
    // 2. Completed solved attempts: expose only for non-tactics and only after viewer finished (or own solved)
    const isVisibleSolvedHistory =
      att.solved && !isTactics && (canRevealSolutions || isViewer);

    const canSeeMoves = isViewerActiveDraft || isVisibleSolvedHistory;
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

    const activeElapsedMs = isViewerActiveDraft
      ? Math.min(
          MAX_ATTEMPT_ELAPSED_MS,
          Math.max(0, Math.round(nowMs - new Date(att.attemptStartedAt).getTime()))
        )
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
      elapsed_ms: activeElapsedMs,
      uci_moves: canSeeMoves ? att.uciMoves : "",
      pgn_moves: isVisibleSolvedHistory ? att.pgnMoves : "",
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
    // Anti-Cheat: never expose tactical_solution until viewer solved or surrendered
    tactical_solution: canRevealSolutions ? challengeRow.tacticalSolution : "",
    domain: challengeRow.domain,
    category: challengeRow.category,
    tactical: canRevealSolutions ? normalized?.tactical : undefined,
    endgame: canRevealSolutions ? normalized?.endgame : undefined,
    my_entry: myEntry,
    leaderboard,
    remaining_active_count: nextActiveInfo.remainingActiveCount,
    next_active_challenge: nextActiveInfo.nextActiveChallenge,
  };
}
