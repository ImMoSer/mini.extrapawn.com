import type {
  BotEngineId,
  ChallengeDifficulty,
  ChallengeDiscipline,
  EndgamePuzzlePayload,
  PuzzleObjective,
  PuzzleStrategyType,
  TacticalPuzzlePayload,
} from "shared";
import { env } from "../config/env.js";
import { resolveBotEngine } from "./engineClient.service.js";

const puzzleServiceUrl = env.PUZZLE_SERVICE_URL.replace(/\/+$/, "");

export interface PuzzleServiceResponse {
  discipline: ChallengeDiscipline;
  tactical?: TacticalPuzzlePayload;
  endgame?: EndgamePuzzlePayload;
}

export interface NormalizedChallengePuzzle {
  discipline: ChallengeDiscipline;
  puzzleId: string;
  difficulty: ChallengeDifficulty;
  botEngine: BotEngineId;
  initialFen: string;
  puzzleFen: string;
  lastMoveUci?: string;
  userColor: "white" | "black";
  firstMove: "bot" | "user";
  strategy: PuzzleStrategyType;
  objective: PuzzleObjective;
  tacticalSolution: string;
  domain: string;
  category: string;
  tactical?: TacticalPuzzlePayload;
  endgame?: EndgamePuzzlePayload;
}

export function normalizePuzzlePayload(
  raw: PuzzleServiceResponse
): NormalizedChallengePuzzle {
  if (raw.tactical) {
    const t = raw.tactical;
    if (!t.puzzle_fen) {
      throw new Error(
        `[PuzzleClient] Missing pre-calculated puzzle_fen for tactical puzzle ${t.puzzle_id}`
      );
    }
    const discipline = t.discipline;
    const difficulty = (t.difficulty || "Novice") as ChallengeDifficulty;
    const botEngine = resolveBotEngine(discipline, difficulty);
    const initialFen = t.tactical_fen;
    const puzzleFen = t.puzzle_fen;
    const firstMove = t.first_move;
    const userColor = t.user_color;
    const strategy = t.strategy;
    const tacticalSolution = t.tactical_solution || "";
    const solutionMoves = tacticalSolution.trim().split(/\s+/).filter(Boolean);
    const lastMoveUci =
      firstMove === "bot" && solutionMoves[0] ? solutionMoves[0] : undefined;

    const category =
      t.goal || t.phase || t.meta_themes?.[0] || t.concept_motifs?.[0] || "MIX";

    return {
      discipline,
      puzzleId: t.puzzle_id,
      difficulty,
      botEngine,
      initialFen,
      puzzleFen,
      lastMoveUci,
      userColor,
      firstMove,
      strategy,
      objective: "win",
      tacticalSolution,
      domain: t.phase || "middlegame",
      category,
      tactical: t,
    };
  }

  if (raw.endgame) {
    const e = raw.endgame;
    if (!e.puzzle_fen) {
      throw new Error(
        `[PuzzleClient] Missing pre-calculated puzzle_fen for endgame puzzle ${e.puzzle_id}`
      );
    }
    const discipline = e.discipline;
    const difficulty = (e.difficulty || "Novice") as ChallengeDifficulty;
    const botEngine = resolveBotEngine(discipline, difficulty);
    const initialFen =
      e.strategy === "scenarioPlus" && e.tactical_fen
        ? e.tactical_fen
        : e.ending_fen;
    const puzzleFen = e.puzzle_fen;
    const firstMove = e.first_move;
    const userColor = e.user_color;
    const strategy = e.strategy;
    const objective = (e.objective || "win") as PuzzleObjective;
    const tacticalSolution = e.tactical_solution || "";
    const solutionMoves = tacticalSolution.trim().split(/\s+/).filter(Boolean);
    const lastMoveUci =
      firstMove === "bot" && solutionMoves[0] ? solutionMoves[0] : undefined;

    return {
      discipline,
      puzzleId: e.puzzle_id,
      difficulty,
      botEngine,
      initialFen,
      puzzleFen,
      lastMoveUci,
      userColor,
      firstMove,
      strategy,
      objective,
      tacticalSolution,
      domain: e.domain || "COMPLEX",
      category: e.class || e.domain || "MIX",
      endgame: e,
    };
  }

  throw new Error(
    "[PuzzleClient] Response contained neither tactical nor endgame payload"
  );
}

export const puzzleClientService = {
  async getPuzzleById(
    discipline: ChallengeDiscipline,
    puzzleId: string
  ): Promise<NormalizedChallengePuzzle> {
    const url = `${puzzleServiceUrl}/api/training/puzzle/${encodeURIComponent(
      discipline
    )}/${encodeURIComponent(puzzleId)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[PuzzleClient] GET ${url} failed (${response.status}): ${errorText}`
      );
    }

    const raw = (await response.json()) as PuzzleServiceResponse;
    return normalizePuzzlePayload(raw);
  },

  async selectClubPuzzle(params: {
    discipline: ChallengeDiscipline;
    difficulty: ChallengeDifficulty;
    focusGroup: string;
    focusKey: string;
    objective: string;
    excludeIds: string[];
  }): Promise<NormalizedChallengePuzzle> {
    const url = `${puzzleServiceUrl}/api/training/puzzle/select`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        discipline: params.discipline,
        difficulty: params.difficulty,
        focus_group: params.focusGroup || "all",
        focus_key: params.focusKey || "all",
        objective: params.objective || "all",
        exclude_ids: params.excludeIds,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[PuzzleClient] POST ${url} failed (${response.status}): ${errorText}`
      );
    }

    const raw = (await response.json()) as PuzzleServiceResponse;
    return normalizePuzzlePayload(raw);
  },
};
