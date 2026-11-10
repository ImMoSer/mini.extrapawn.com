import { FastifyPluginAsync } from "fastify";
import type { BotEngineId } from "shared";
import { engineClientService } from "../services/engineClient.service.js";

export const engineRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: {
      engine: BotEngineId;
      start_fen: string;
      moves: string[];
    };
  }>(
    "/engine/bestmove",
    { preHandler: [fastify.authenticate] },
    async (req) => {
      const { engine, start_fen, moves } = req.body;
      return engineClientService.getBestMove(engine, start_fen, moves || []);
    }
  );

  fastify.post<{
    Body: {
      fen: string;
      max_candidates?: number;
      include_pv?: boolean;
    };
  }>(
    "/engine/gaviota",
    { preHandler: [fastify.authenticate] },
    async (req) => {
      const { fen, max_candidates = 5, include_pv = false } = req.body;
      return engineClientService.getGaviotaLines(
        fen,
        max_candidates,
        include_pv
      );
    }
  );

  fastify.post<{
    Body: {
      user_id?: string;
      start_fen: string;
      moves?: string[];
    };
  }>(
    "/coach-engine/uci_fen",
    { preHandler: [fastify.authenticate] },
    async (req) => {
      const { user_id, start_fen, moves } = req.body;
      const effectiveUserId =
        user_id?.trim() || req.user.username || req.user.telegramId || "mini_user";
      return engineClientService.analyzeCoachUciFen(
        effectiveUserId,
        start_fen,
        Array.isArray(moves) ? moves : []
      );
    }
  );
};

