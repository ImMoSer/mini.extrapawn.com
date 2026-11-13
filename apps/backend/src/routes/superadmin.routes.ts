import { count, desc, eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import {
  DEFAULT_PROMO_FILE_ID,
  validateTelegramPromoHtml,
  type ClubStatus,
  type PromoCampaignDTO,
  type SuperAdminOverviewDTO,
} from "shared";
import { telegramBotService } from "../bot/telegramBot.service.js";
import { db } from "../db/index.js";
import {
  challengeAttempts,
  clubAdmins,
  clubChallenges,
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
        file_id: p.fileId || p.imageUrl || DEFAULT_PROMO_FILE_ID,
        text_ru: p.textRu,
        text_en: p.textEn,
        text_de: p.textDe || p.textEn,
        button_ru: p.buttonRu,
        button_en: p.buttonEn,
        button_de: p.buttonDe || p.buttonEn,
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
        await telegramBotService.sendBlockedClubNoticeAndLeave(
          chatId,
          updated.topicThreadId,
          updated.language
        );
      }

      return mapClubRowToSummaryDTO(updated, req.user.telegramId, true);
    }
  );

  // Legitimacy toggle: Block (blacklist + send QR notice + leave) / Unblock
  fastify.post<{
    Params: { chatId: string };
    Body: {
      blocked: boolean;
      blocked_reason?: string | null;
    };
  }>(
    "/superadmin/clubs/:chatId/block",
    { preHandler: [fastify.requireSuperadmin] },
    async (req, reply) => {
      const { chatId } = req.params;
      const { blocked, blocked_reason = null } = req.body;

      const [row] = await db
        .select()
        .from(clubs)
        .where(eq(clubs.chatId, chatId))
        .limit(1);

      if (!row) {
        return reply.code(404).send({ error: "Club not found" });
      }
      if (row.isDefault && blocked) {
        return reply
          .code(400)
          .send({ error: "Default club cannot be blocked" });
      }

      const nextStatus: ClubStatus = blocked
        ? "blocked"
        : row.isActive
          ? "active"
          : "paused";

      const [updated] = await db
        .update(clubs)
        .set({
          status: nextStatus,
          blockedReason: blocked
            ? blocked_reason || "Blocked by SuperAdmin"
            : null,
          updatedAt: new Date(),
        })
        .where(eq(clubs.chatId, chatId))
        .returning();

      if (blocked) {
        await telegramBotService.sendBlockedClubNoticeAndLeave(
          chatId,
          row.topicThreadId,
          row.language
        );
      }

      return mapClubRowToSummaryDTO(updated ?? row, req.user.telegramId, true);
    }
  );

  // Purge club activity history (and remove club row completely if not blacklisted)
  fastify.delete<{
    Params: { chatId: string };
  }>(
    "/superadmin/clubs/:chatId/data",
    { preHandler: [fastify.requireSuperadmin] },
    async (req, reply) => {
      const { chatId } = req.params;

      const [row] = await db
        .select()
        .from(clubs)
        .where(eq(clubs.chatId, chatId))
        .limit(1);

      if (!row) {
        return reply.code(404).send({ error: "Club not found" });
      }

      // Always delete all challenge attempts & published challenges for this club
      await db
        .delete(challengeAttempts)
        .where(eq(challengeAttempts.chatId, chatId));
      await db
        .delete(clubChallenges)
        .where(eq(clubChallenges.chatId, chatId));

      // If blacklisted or default club: keep the club row so blacklist / official club remains intact
      if (row.status === "blocked" || row.isDefault) {
        await telegramBotService.clearAutoPause(chatId);
        if (row.status === "blocked") {
          await db.delete(clubAdmins).where(eq(clubAdmins.chatId, chatId));
        }
        const [updated] = await db
          .update(clubs)
          .set({
            memberCount: row.status === "blocked" ? 0 : row.memberCount,
            lastPublishedAt: null,
            lastLeaderboardAt: null,
            updatedAt: new Date(),
          })
          .where(eq(clubs.chatId, chatId))
          .returning();

        return {
          ok: true,
          deleted_club_row: false,
          club: await mapClubRowToSummaryDTO(
            updated ?? row,
            req.user.telegramId,
            true
          ),
        };
      }

      // If not blacklisted and not default: leave Telegram chat and delete everything about the club
      await telegramBotService.leaveClubChat(chatId);
      await db.delete(clubs).where(eq(clubs.chatId, chatId));

      return {
        ok: true,
        deleted_club_row: true,
        club: null,
      };
    }
  );

  fastify.post<{
    Body: {
      title: string;
      file_id?: string | null;
      text_ru: string;
      text_en: string;
      text_de: string;
      button_ru?: string | null;
      button_en?: string | null;
      button_de?: string | null;
      target_url?: string | null;
      broadcast_now?: boolean;
    };
  }>(
    "/superadmin/promos",
    { preHandler: [fastify.requireSuperadmin] },
    async (req, reply) => {
      const body = req.body;
      const textRu = (body.text_ru || "").trim();
      const textEn = (body.text_en || "").trim();
      const textDe = (body.text_de || "").trim();

      const errRu = validateTelegramPromoHtml(textRu, "RU");
      if (errRu) return reply.code(400).send({ error: errRu });

      const errEn = validateTelegramPromoHtml(textEn, "EN");
      if (errEn) return reply.code(400).send({ error: errEn });

      const errDe = validateTelegramPromoHtml(textDe, "DE");
      if (errDe) return reply.code(400).send({ error: errDe });

      const cleanFileId = body.file_id?.trim() || DEFAULT_PROMO_FILE_ID;

      const [inserted] = await db
        .insert(promoCampaigns)
        .values({
          title: (body.title || "ExtraPawn Main App Promo").trim(),
          fileId: cleanFileId,
          textRu,
          textEn,
          textDe,
          buttonRu: body.button_ru?.trim() || null,
          buttonEn: body.button_en?.trim() || null,
          buttonDe: body.button_de?.trim() || null,
          targetUrl: body.target_url?.trim() || null,
          imageUrl: cleanFileId,
          isActive: true,
        })
        .returning();

      let sentToClubs = 0;
      if (body.broadcast_now && inserted) {
        sentToClubs = await telegramBotService.broadcastPromoCampaign({
          fileId: inserted.fileId,
          textRu: inserted.textRu,
          textEn: inserted.textEn,
          textDe: inserted.textDe,
          buttonRu: inserted.buttonRu,
          buttonEn: inserted.buttonEn,
          buttonDe: inserted.buttonDe,
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
              file_id: inserted.fileId,
              text_ru: inserted.textRu,
              text_en: inserted.textEn,
              text_de: inserted.textDe,
              button_ru: inserted.buttonRu,
              button_en: inserted.buttonEn,
              button_de: inserted.buttonDe,
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

