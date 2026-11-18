import type { Key } from "@lichess-org/chessground/types";
import type { Ref } from "vue";
import type {
  ChallengeStateDTO,
  PlayChallengeMoveResponseDTO,
} from "shared";
import {
  applyMoveToFen,
  resolveSetupMoveBetweenFens,
  type AppliedMoveResult,
} from "@/entities/chess/lib/chessPosition";
import { apiRequest } from "@/shared/api/httpClient";
import { playAppliedMoveSound } from "@/shared/lib/sound";
import { triggerHapticImpact } from "@/shared/lib/telegram";

export const BOT_NORMALIZED_MOVE_TIME_MS = 250;
export const MIN_USER_MOVE_TIME_MS = 100;
export const MAX_USER_MOVE_TIME_MS = 10_000;
const DRAG_MIN_BOT_GAP_MS = 55;
const CLICK_MIN_BOT_GAP_MS = 135;
const TERMINAL_BOT_PREVIEW_MS = 500;

export type EvaluatedMoveResult = AppliedMoveResult & {
  isThreefoldRepetition: boolean;
};

export interface ParsedChallengeBoardRoot {
  initialLastMove: [Key, Key] | undefined;
  solvedTacticalMoves: string[];
  coachRootFen: string;
  coachPrefixMoves: string[];
}

export function parseChallengeBoardRoot(
  state: ChallengeStateDTO
): ParsedChallengeBoardRoot {
  const setupApplied = resolveSetupMoveBetweenFens(
    state.initial_fen,
    state.puzzle_fen
  );

  const initialLastMove: [Key, Key] | undefined = setupApplied
    ? [setupApplied.from, setupApplied.to]
    : undefined;
  const coachRootFen = setupApplied ? state.initial_fen : state.puzzle_fen;
  const coachPrefixMoves = setupApplied ? [setupApplied.uci] : [];

  const rawSolution = (state.tactical_solution || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const solvedTacticalMoves =
    state.first_move === "bot" && rawSolution.length > 0
      ? rawSolution.slice(1)
      : rawSolution;

  return {
    initialLastMove,
    solvedTacticalMoves,
    coachRootFen,
    coachPrefixMoves,
  };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createChallengeEngineFlow(deps: {
  challenge: Ref<ChallengeStateDTO | null>;
  currentFen: Ref<string>;
  boardRevision: Ref<number>;
  isBotThinking: Ref<boolean>;
  error: Ref<string | null>;
  getTurnStartedAt: () => number;
  isFinished: () => boolean;
  commitAppliedMove: (
    applied: AppliedMoveResult,
    plyDurationMs: number
  ) => EvaluatedMoveResult;
  rollbackOptimisticMove: () => void;
  onSolvedFromServer: (state: ChallengeStateDTO) => void;
  onFailedAttemptFromServer: (state: ChallengeStateDTO) => void;
}) {
  async function executeActiveSolvingMove(
    uciMove: string,
    options?: { wasDragged?: boolean }
  ): Promise<void> {
    const c = deps.challenge.value;
    if (!c || deps.isFinished()) return;

    const preview = applyMoveToFen(deps.currentFen.value, uciMove);
    const userPlyDurationMs = Math.min(
      MAX_USER_MOVE_TIME_MS,
      Math.max(MIN_USER_MOVE_TIME_MS, Date.now() - deps.getTurnStartedAt())
    );

    const revisionAtRequest = deps.boardRevision.value;
    const requestStartedAt = Date.now();

    // Batch isBotThinking=true and user move into a single synchronous Vue flush
    deps.isBotThinking.value = true;
    deps.error.value = null;
    const userEvaluated = deps.commitAppliedMove(preview, userPlyDurationMs);
    triggerHapticImpact("light");
    playAppliedMoveSound(userEvaluated);

    const minBotGapMs = options?.wasDragged
      ? DRAG_MIN_BOT_GAP_MS
      : CLICK_MIN_BOT_GAP_MS;

    try {
      const res = await apiRequest<PlayChallengeMoveResponseDTO>(
        `/challenges/${encodeURIComponent(c.discipline)}/${encodeURIComponent(
          c.puzzle_id
        )}/${encodeURIComponent(c.edition)}/${encodeURIComponent(
          c.chat_id
        )}/move`,
        {
          method: "POST",
          body: JSON.stringify({
            uci_move: preview.uci,
            move_time_ms: userPlyDurationMs,
          }),
        }
      );

      if (deps.boardRevision.value !== revisionAtRequest) {
        return;
      }

      if (res.outcome === "wrong_move") {
        deps.isBotThinking.value = false;
        if (res.state) {
          deps.onFailedAttemptFromServer(res.state);
        }
        return;
      }

      if (res.bot_move_uci) {
        const elapsedSinceSend = Date.now() - requestStartedAt;
        if (elapsedSinceSend < minBotGapMs) {
          await sleepMs(minBotGapMs - elapsedSinceSend);
          if (deps.boardRevision.value !== revisionAtRequest) {
            return;
          }
        }
      }

      if (res.outcome === "continue") {
        // Single-tick atomic flush: flip isBotThinking=false TOGETHER with applying the bot move
        // and leave challenge.value untouched -> Chessground runs ground.set() ONCE with zero mid-flight interruption!
        deps.isBotThinking.value = false;
        if (res.bot_move_uci) {
          const botEvaluated = deps.commitAppliedMove(
            applyMoveToFen(deps.currentFen.value, res.bot_move_uci),
            BOT_NORMALIZED_MOVE_TIME_MS
          );
          playAppliedMoveSound(botEvaluated);
        }
        return;
      }

      if (res.outcome === "solved") {
        deps.isBotThinking.value = false;
        if (res.bot_move_uci) {
          const botEvaluated = deps.commitAppliedMove(
            applyMoveToFen(deps.currentFen.value, res.bot_move_uci),
            BOT_NORMALIZED_MOVE_TIME_MS
          );
          playAppliedMoveSound(botEvaluated);
        }
        if (res.state) {
          deps.onSolvedFromServer(res.state);
        }
        return;
      }

      if (res.outcome === "failed_attempt") {
        if (res.bot_move_uci) {
          const botEvaluated = deps.commitAppliedMove(
            applyMoveToFen(deps.currentFen.value, res.bot_move_uci),
            BOT_NORMALIZED_MOVE_TIME_MS
          );
          playAppliedMoveSound(botEvaluated);
          await sleepMs(TERMINAL_BOT_PREVIEW_MS);
          if (deps.boardRevision.value !== revisionAtRequest) {
            return;
          }
        }
        deps.isBotThinking.value = false;
        if (res.state) {
          deps.onFailedAttemptFromServer(res.state);
        }
      }
    } catch (err) {
      if (deps.boardRevision.value !== revisionAtRequest) {
        return;
      }
      deps.isBotThinking.value = false;
      deps.rollbackOptimisticMove();
      deps.error.value = err instanceof Error ? err.message : String(err);
      console.error("[ChallengeSession] Move submission failed:", err);
    } finally {
      if (
        deps.isBotThinking.value &&
        deps.boardRevision.value === revisionAtRequest
      ) {
        deps.isBotThinking.value = false;
      }
    }
  }

  return {
    executeActiveSolvingMove,
  };
}
