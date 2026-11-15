import type { Key } from "@lichess-org/chessground/types";
import type { Ref } from "vue";
import type { ChallengeStateDTO } from "shared";
import {
  analyzeFenPosition,
  applyMoveToFen,
  type AppliedMoveResult,
} from "@/entities/chess/lib/chessPosition";
import { apiRequest } from "@/shared/api/httpClient";
import { playAppliedMoveSound } from "@/shared/lib/sound";
import { triggerHapticImpact } from "@/shared/lib/telegram";

export const BOT_NORMALIZED_MOVE_TIME_MS = 250;
export const MIN_USER_MOVE_TIME_MS = 100;
export const MAX_USER_MOVE_TIME_MS = 10_000;

export type EvaluatedMoveResult = AppliedMoveResult & {
  isThreefoldRepetition: boolean;
};

export interface ParsedChallengeBoardRoot {
  initialLastMove: [Key, Key] | undefined;
  expectedSolutionMoves: string[];
  coachRootFen: string;
  coachPrefixMoves: string[];
}

export function parseChallengeBoardRoot(
  state: ChallengeStateDTO
): ParsedChallengeBoardRoot {
  const rawSolution = (state.tactical_solution || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let initialLastMove: [Key, Key] | undefined = undefined;
  let expectedSolutionMoves = rawSolution;
  let coachRootFen = state.puzzle_fen;
  let coachPrefixMoves: string[] = [];

  if (state.first_move === "bot" && rawSolution[0]) {
    const m0 = rawSolution[0];
    initialLastMove = [m0.slice(0, 2) as Key, m0.slice(2, 4) as Key];
    expectedSolutionMoves = rawSolution.slice(1);

    if (state.initial_fen && state.initial_fen !== state.puzzle_fen) {
      try {
        const checkSetup = applyMoveToFen(state.initial_fen, m0);
        if (
          checkSetup.nextFen.split(" ")[0] === state.puzzle_fen.split(" ")[0]
        ) {
          coachRootFen = state.initial_fen;
          coachPrefixMoves = [checkSetup.uci];
        }
      } catch {
        coachRootFen = state.puzzle_fen;
        coachPrefixMoves = [];
      }
    }
  }

  return {
    initialLastMove,
    expectedSolutionMoves,
    coachRootFen,
    coachPrefixMoves,
  };
}

export async function fetchGaviotaHintIfFewPieces(
  fen: string
): Promise<string | null> {
  const snap = analyzeFenPosition(fen);
  if (snap.piecesCount > 5) {
    return null;
  }
  try {
    const res = await apiRequest<{
      candidates?: { uci: string; outcome?: string; dtm?: number }[];
    }>("/engine/gaviota", {
      method: "POST",
      body: JSON.stringify({
        fen,
        max_candidates: 3,
        include_pv: false,
      }),
    });
    const top = res?.candidates?.[0];
    if (top) {
      return `Gaviota TB: ${top.uci} (${top.outcome ?? "TB"}${
        top.dtm !== undefined ? ` DTM ${top.dtm}` : ""
      })`;
    }
  } catch {
    // Ignore if TableService is unreachable
  }
  return null;
}

export function createChallengeEngineFlow(deps: {
  challenge: Ref<ChallengeStateDTO | null>;
  currentFen: Ref<string>;
  boardRevision: Ref<number>;
  expectedSolutionMoves: Ref<string[]>;
  scenarioStepIndex: Ref<number>;
  playedUciMoves: Ref<string[]>;
  isBotThinking: Ref<boolean>;
  error: Ref<string | null>;
  gaviotaHint: Ref<string | null>;
  isFinished: () => boolean;
  commitAppliedMove: (
    applied: AppliedMoveResult,
    actor: "user" | "bot"
  ) => EvaluatedMoveResult;
  completeSolvedChallenge: () => Promise<void>;
  recordFailedAttempt: (resetToStart: boolean) => Promise<void>;
}) {
  async function handleTerminalMoveOutcome(
    evaluated: EvaluatedMoveResult,
    actor: "user" | "bot"
  ): Promise<boolean> {
    if (!deps.challenge.value) return false;

    if (evaluated.isCheckmate) {
      if (actor === "user") {
        await deps.completeSolvedChallenge();
      } else {
        await deps.recordFailedAttempt(true);
      }
      return true;
    }

    if (evaluated.isDraw) {
      if (deps.challenge.value.objective === "hold_draw") {
        await deps.completeSolvedChallenge();
      } else {
        await deps.recordFailedAttempt(true);
      }
      return true;
    }

    return false;
  }

  async function requestBotSparringMove(): Promise<void> {
    if (!deps.challenge.value) return;
    const revisionAtRequest = deps.boardRevision.value;
    deps.isBotThinking.value = true;
    deps.error.value = null;
    try {
      const res = await apiRequest<{ bestMove: string | null }>(
        "/engine/bestmove",
        {
          method: "POST",
          body: JSON.stringify({
            engine: deps.challenge.value.bot_engine,
            start_fen: deps.challenge.value.puzzle_fen,
            moves: deps.playedUciMoves.value,
          }),
        }
      );

      if (
        deps.boardRevision.value !== revisionAtRequest ||
        !deps.challenge.value ||
        deps.isFinished()
      ) {
        return;
      }

      if (!res.bestMove) {
        throw new Error(
          "[ChallengeSession] Engine returned empty bestMove for non-terminal position."
        );
      }

      const evaluated = deps.commitAppliedMove(
        applyMoveToFen(deps.currentFen.value, res.bestMove),
        "bot"
      );
      playAppliedMoveSound(evaluated);

      void fetchGaviotaHintIfFewPieces(deps.currentFen.value).then((hint) => {
        deps.gaviotaHint.value = hint;
      });

      await handleTerminalMoveOutcome(evaluated, "bot");
    } catch (err) {
      if (deps.boardRevision.value !== revisionAtRequest) {
        return;
      }
      deps.error.value = err instanceof Error ? err.message : String(err);
      console.error("[ChallengeSession] Bot move failed:", err);
    } finally {
      if (deps.boardRevision.value === revisionAtRequest) {
        deps.isBotThinking.value = false;
      }
    }
  }

  async function executeActiveSolvingMove(uciMove: string): Promise<void> {
    const c = deps.challenge.value;
    if (!c) return;

    const expectedUci =
      deps.expectedSolutionMoves.value[deps.scenarioStepIndex.value];
    if (expectedUci) {
      const preview = applyMoveToFen(deps.currentFen.value, uciMove);
      const isMatch =
        uciMove === expectedUci ||
        (uciMove.slice(0, 4) === expectedUci.slice(0, 4) &&
          uciMove.length === 5 &&
          expectedUci.length === 4) ||
        preview.isCheckmate;

      if (!isMatch) {
        await deps.recordFailedAttempt(true);
        return;
      }

      const evaluated = deps.commitAppliedMove(preview, "user");
      deps.scenarioStepIndex.value += 1;
      triggerHapticImpact("light");
      playAppliedMoveSound(evaluated);

      if (await handleTerminalMoveOutcome(evaluated, "user")) {
        return;
      }

      if (
        deps.scenarioStepIndex.value >= deps.expectedSolutionMoves.value.length &&
        c.strategy === "scenarioOnly"
      ) {
        await deps.completeSolvedChallenge();
        return;
      }

      const botUci =
        deps.expectedSolutionMoves.value[deps.scenarioStepIndex.value];
      if (botUci) {
        const revisionAtDelay = deps.boardRevision.value;
        deps.isBotThinking.value = true;
        let botEvaluated: EvaluatedMoveResult | null = null;
        try {
          await new Promise((r) => setTimeout(r, BOT_NORMALIZED_MOVE_TIME_MS));
          if (
            deps.boardRevision.value !== revisionAtDelay ||
            !deps.challenge.value ||
            deps.isFinished()
          ) {
            return;
          }
          botEvaluated = deps.commitAppliedMove(
            applyMoveToFen(deps.currentFen.value, botUci),
            "bot"
          );
          deps.scenarioStepIndex.value += 1;
        } finally {
          if (deps.boardRevision.value === revisionAtDelay) {
            deps.isBotThinking.value = false;
          }
        }
        if (!botEvaluated) return;
        playAppliedMoveSound(botEvaluated);

        if (await handleTerminalMoveOutcome(botEvaluated, "bot")) {
          return;
        }
      }

      const turnColor = analyzeFenPosition(deps.currentFen.value).turnColor;
      if (
        deps.scenarioStepIndex.value >= deps.expectedSolutionMoves.value.length &&
        c.strategy === "scenarioPlus" &&
        turnColor !== c.user_color
      ) {
        await requestBotSparringMove();
      }
      return;
    }

    const evaluated = deps.commitAppliedMove(
      applyMoveToFen(deps.currentFen.value, uciMove),
      "user"
    );
    triggerHapticImpact("light");
    playAppliedMoveSound(evaluated);

    if (await handleTerminalMoveOutcome(evaluated, "user")) {
      return;
    }

    await requestBotSparringMove();
  }

  return {
    executeActiveSolvingMove,
  };
}
