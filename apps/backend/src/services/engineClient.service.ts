import type { BotEngineId, ChallengeDifficulty, ChallengeDiscipline } from "shared";
import { env } from "../config/env.js";

const maiaHubUrl = env.MAIA_HUB_URL.replace(/\/+$/, "");
const tableServiceUrl = env.TABLESERVICE_URL.replace(/\/+$/, "");
const coachEngineUrl = env.COACH_ENGINE_URL.replace(/\/+$/, "");

export function resolveBotEngine(
  discipline: ChallengeDiscipline,
  difficulty: ChallengeDifficulty
): BotEngineId {
  if (discipline === "theoretical_endgames") {
    return "mozero";
  }
  if (difficulty === "Master") {
    return "mozero";
  }
  if (difficulty === "Pro") {
    return "maia-2200";
  }
  return "maia-1500";
}

export const engineClientService = {
  /**
   * Requests the best move from `engine-hub:5000` (`maia-1500`, `maia-2200`, or `mozero`).
   */
  async getBestMove(
    engine: BotEngineId,
    startFen: string,
    moves: string[]
  ): Promise<{ bestMove: string }> {
    const response = await fetch(`${maiaHubUrl}/bestmove`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        engine,
        start_fen: startFen,
        moves,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[EngineClient] Engine Hub HTTP ${response.status}: ${errorText}`
      );
    }

    const data = (await response.json()) as { bestMove: string };
    return data;
  },

  /**
   * Requests Gaviota tablebase lines for positions with <= 5 pieces from `tableservice:5000`.
   */
  async getGaviotaLines(
    fen: string,
    maxCandidates: number = 5,
    includePv: boolean = false
  ): Promise<unknown> {
    const response = await fetch(`${tableServiceUrl}/gaviota/explainer-lines`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        fen,
        max_candidates: maxCandidates,
        include_pv: includePv,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[EngineClient] TableService Gaviota HTTP ${response.status}: ${errorText}`
      );
    }

    return await response.json();
  },

  /**
   * Requests Coach position explanation and visual_commands from `stockfish_server:5000/uci_fen`.
   */
  async analyzeCoachUciFen(
    userId: string,
    startFen: string,
    moves: string[]
  ): Promise<unknown> {
    const response = await fetch(`${coachEngineUrl}/uci_fen`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        user_id: userId,
        start_fen: startFen,
        moves,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[EngineClient] Coach Engine HTTP ${response.status}: ${errorText}`
      );
    }

    return await response.json();
  },
};

