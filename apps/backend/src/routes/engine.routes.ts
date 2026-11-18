import { and, eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import type { ChallengeDiscipline } from "shared";
import { db } from "../db/index.js";
import { challengeAttempts } from "../db/schema.js";
import { engineClientService } from "../services/engineClient.service.js";
import { coachUciFenBodySchema } from "./schemas.js";

export const engineRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: {
      user_id?: string;
      discipline: ChallengeDiscipline;
      puzzle_id: string;
      edition: string;
      chat_id: string;
      start_fen: string;
      moves?: string[];
    };
  }>(
    "/coach-engine/uci_fen",
    {
      preHandler: [fastify.authenticate],
      schema: { body: coachUciFenBodySchema },
    },
    async (req, reply) => {
      const { discipline, puzzle_id, edition, chat_id, start_fen, moves } =
        req.body;
      const safeEdition = edition || "0";

      if (!req.user.isSuperadmin) {
        const [attempt] = await db
          .select({ status: challengeAttempts.status })
          .from(challengeAttempts)
          .where(
            and(
              eq(challengeAttempts.chatId, chat_id),
              eq(challengeAttempts.discipline, discipline),
              eq(challengeAttempts.puzzleId, puzzle_id),
              eq(challengeAttempts.edition, safeEdition),
              eq(challengeAttempts.telegramId, req.user.telegramId)
            )
          )
          .limit(1);

        if (
          attempt?.status !== "solved" &&
          attempt?.status !== "surrendered"
        ) {
          return reply.code(403).send({
            error:
              "Coach analysis is locked until you solve or surrender the challenge.",
          });
        }
      }

      const effectiveUserId =
        req.user.username || req.user.telegramId || "mini_user";
      return engineClientService.analyzeCoachUciFen(
        effectiveUserId,
        start_fen,
        Array.isArray(moves) ? moves : []
      );
    }
  );
};
