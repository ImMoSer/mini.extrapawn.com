import { count, desc, eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import type {
  ClubStatus,
  PromoCampaignDTO,
  SuperAdminOverviewDTO,
} from "shared";
import { telegramBotService } from "../bot/telegramBot.service.js";
import { db } from "../db/index.js";
import {
  challengeAttempts,
  clubs,
  promoCampaigns,
  users,
} from "../db/schema.js";
import { mapClubRowToSummaryDTO } from "../services/clubMapper.js";

export const superadminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/superadmin/overview",
    { preHandler: [fastify.requireSuperadmin] },
    async (req) => {
      const [usersCount] = await db.select({ value: count() }).from(users);
      const [clubsCount] = await db.select({ value: count() }).from(clubs);
      const [attemptsCount] = await db
        .select({ value: count() })
        .from(challengeAttempts);
      const [solvedCount] = await db
        .select({ value: count() })
        .from(challengeAttempts)
        .where(eq(challengeAttempts.solved, true));

      const clubRows = await db
        .select()
        .from(clubs)
        .orderBy(desc(clubs.isDefault), desc(clubs.createdAt));

      const clubDtos = await Promise.all(
        clubRows.map((c) =>
          mapClubRowToSummaryDTO(c, req.user.telegramId, true)
        )
      );

      const promoRows = await db
        .select()
        .from(promoCampaigns)
        .orderBy(desc(promoCampaigns.createdAt));

      const promoDtos: PromoCampaignDTO[] = promoRows.map((p) => ({
        id: p.id,
        title: p.title,
        text_ru: p.textRu,
        text_en: p.textEn,
        button_ru: p.buttonRu,
        button_en: p.buttonEn,
        target_url: p.targetUrl,
        image_url: p.imageUrl,
        is_active: p.isActive,
        created_at: p.createdAt.toISOString(),
      }));

      const overview: SuperAdminOverviewDTO = {
        total_users: Number(usersCount?.value ?? 0),
        total_clubs: Number(clubsCount?.value ?? 0),
        total_attempts: Number(attemptsCount?.value ?? 0),
        total_solved: Number(solvedCount?.value ?? 0),
        clubs: clubDtos,
        promos: promoDtos,
      };

      return overview;
    }
  );

  fastify.post<{
    Params: { chatId: string };
    Body: {
      status: ClubStatus;
      blocked_reason?: string | null;
      leave_chat?: boolean;
    };
  }>(
    "/superadmin/clubs/:chatId/status",
    { preHandler: [fastify.requireSuperadmin] },
    async (req, reply) => {
      const { chatId } = req.params;
      const { status, blocked_reason = null, leave_chat = false } = req.body;

      const [updated] = await db
        .update(clubs)
        .set({
          status,
          blockedReason: status === "blocked" ? blocked_reason : null,
          updatedAt: new Date(),
        })
        .where(eq(clubs.chatId, chatId))
        .returning();

      if (!updated) {
        return reply.code(404).send({ error: "Club not found" });
      }

      if (status === "blocked" && leave_chat) {
        await telegramBotService.leaveClubChat(
          chatId,
          blocked_reason
            ? `⛔ Бот отключен администратором ExtraPawn: ${blocked_reason}`
            : "⛔ Бот отключен администратором ExtraPawn."
        );
      }

      return mapClubRowToSummaryDTO(updated, req.user.telegramId, true);
    }
  );

  fastify.post<{
    Body: {
      title: string;
      text_ru: string;
      text_en: string;
      button_ru?: string | null;
      button_en?: string | null;
      target_url?: string | null;
      broadcast_now?: boolean;
    };
  }>(
    "/superadmin/promos",
    { preHandler: [fastify.requireSuperadmin] },
    async (req) => {
      const body = req.body;
      const [inserted] = await db
        .insert(promoCampaigns)
        .values({
          title: body.title.trim(),
          textRu: body.text_ru.trim(),
          textEn: (body.text_en || body.text_ru).trim(),
          buttonRu: body.button_ru?.trim() || null,
          buttonEn: body.button_en?.trim() || null,
          targetUrl: body.target_url?.trim() || null,
          isActive: true,
        })
        .returning();

      let sentToClubs = 0;
      if (body.broadcast_now && inserted) {
        sentToClubs = await telegramBotService.broadcastPromoCampaign({
          textRu: inserted.textRu,
          textEn: inserted.textEn,
          buttonRu: inserted.buttonRu,
          buttonEn: inserted.buttonEn,
          targetUrl: inserted.targetUrl,
        });
      }

      return {
        ok: true,
        sent_to_clubs: sentToClubs,
        promo: inserted
          ? {
              id: inserted.id,
              title: inserted.title,
              text_ru: inserted.textRu,
              text_en: inserted.textEn,
              button_ru: inserted.buttonRu,
              button_en: inserted.buttonEn,
              target_url: inserted.targetUrl,
              image_url: inserted.imageUrl,
              is_active: inserted.isActive,
              created_at: inserted.createdAt.toISOString(),
            }
          : null,
      };
    }
  );
};

