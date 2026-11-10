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

export type RawPuzzleServicePayload =
  | PuzzleServiceResponse
  | TacticalPuzzlePayload
  | EndgamePuzzlePayload;

function extractPayloads(raw: RawPuzzleServicePayload): {
  tactical?: TacticalPuzzlePayload;
  endgame?: EndgamePuzzlePayload;
} {
  if ("tactical" in raw && raw.tactical) {
    return { tactical: raw.tactical };
  }
  if ("endgame" in raw && raw.endgame) {
    return { endgame: raw.endgame };
  }
  if ("puzzle_id" in raw) {
    if ("ending_fen" in raw && typeof raw.ending_fen === "string") {
      return { endgame: raw as EndgamePuzzlePayload };
    }
    if ("tactical_fen" in raw && typeof raw.tactical_fen === "string") {
      return { tactical: raw as TacticalPuzzlePayload };
    }
  }
  return {};
}

export function normalizePuzzlePayload(
  raw: RawPuzzleServicePayload
): NormalizedChallengePuzzle {
  const extracted = extractPayloads(raw);

  if (extracted.tactical) {
    const t = extracted.tactical;
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

  if (extracted.endgame) {
    const e = extracted.endgame;
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

const TACTICS_FOCUS_GROUPS = new Set([
  "phase",
  "length",
  "goal",
  "master_game",
  "cognitive",
  "motif_group",
  "geometry",
  "operator",
  "concept",
  "trigger",
  "motif",
]);

const THEORETICAL_DOMAINS = new Set([
  "PAWN",
  "KNIGHT",
  "BISHOP",
  "ROOK",
  "QUEEN",
  "COMPLEX",
]);

const PRACTICAL_DOMAINS = new Set([
  "PAWN",
  "KNIGHT",
  "BISHOP",
  "ROOK",
  "QUEEN",
  "COMPLEX",
  "EXTRA",
]);

function normalizeSelectFilterForDiscipline(params: {
  discipline: ChallengeDiscipline;
  focusGroup: string;
  focusKey: string;
  objective: string;
}): {
  focusGroup: string;
  focusKey: string;
  objective?: string;
} {
  const rawGroup = (params.focusGroup || "all").trim();
  const rawKey = (params.focusKey || "all").trim();
  const rawObj = (params.objective || "").trim();

  const validObjective =
    params.discipline === "theoretical_endgames" &&
    (rawObj === "win" || rawObj === "hold_draw")
      ? rawObj
      : undefined;

  if (rawGroup === "all" || rawKey === "all" || !rawGroup || !rawKey) {
    return {
      focusGroup: "all",
      focusKey: "all",
      objective: validObjective,
    };
  }

  if (params.discipline === "tactics") {
    if (TACTICS_FOCUS_GROUPS.has(rawGroup)) {
      return {
        focusGroup: rawGroup,
        focusKey: rawKey,
      };
    }
    return { focusGroup: "all", focusKey: "all" };
  }

  if (params.discipline === "theoretical_endgames") {
    if (
      rawGroup === "objective" &&
      (rawKey === "win" || rawKey === "hold_draw")
    ) {
      return {
        focusGroup: "objective",
        focusKey: rawKey,
        objective: rawKey,
      };
    }
    if (rawGroup === "domain" && THEORETICAL_DOMAINS.has(rawKey)) {
      return {
        focusGroup: "domain",
        focusKey: rawKey,
        objective: validObjective,
      };
    }
    return {
      focusGroup: "all",
      focusKey: "all",
      objective: validObjective,
    };
  }

  // practical_chess & finishhim
  if (rawGroup === "domain" && PRACTICAL_DOMAINS.has(rawKey)) {
    return {
      focusGroup: "domain",
      focusKey: rawKey,
    };
  }

  return { focusGroup: "all", focusKey: "all" };
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
      headers: {
        Accept: "application/json",
        "X-User-Id": "tele_app",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[PuzzleClient] GET ${url} failed (${response.status}): ${errorText}`
      );
    }

    const raw = (await response.json()) as RawPuzzleServicePayload;
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
    const normalized = normalizeSelectFilterForDiscipline(params);

    const doSelect = async (filter: {
      focusGroup: string;
      focusKey: string;
      objective?: string;
    }) => {
      const payload: Record<string, unknown> = {
        discipline: params.discipline,
        difficulty: params.difficulty,
        focus_group: filter.focusGroup,
        focus_key: filter.focusKey,
        exclude_ids: params.excludeIds,
      };
      if (filter.objective) {
        payload.objective = filter.objective;
      }

      return fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
    };

    let response = await doSelect(normalized);

    // If a specific focus/objective slice had no matching puzzles or was incompatible, fallback to "all"
    if (
      !response.ok &&
      (normalized.focusGroup !== "all" ||
        normalized.focusKey !== "all" ||
        normalized.objective)
    ) {
      response = await doSelect({ focusGroup: "all", focusKey: "all" });
    }

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
