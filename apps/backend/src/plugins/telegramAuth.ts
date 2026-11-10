import crypto from "crypto";
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { AppLanguage } from "shared";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";

export interface AuthenticatedTelegramUser {
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  avatarUrl: string | null;
  languageCode: AppLanguage;
  isSuperadmin: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthenticatedTelegramUser;
  }
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
    requireSuperadmin: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  }
}

interface RawTelegramWebAppUser {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

function normalizeLanguage(code?: string): AppLanguage {
  if (!code) return "ru";
  const lower = code.toLowerCase();
  if (lower.startsWith("en")) return "en";
  if (lower.startsWith("de")) return "de";
  return "ru";
}

async function upsertUserRecord(
  raw: RawTelegramWebAppUser
): Promise<AuthenticatedTelegramUser> {
  const telegramId = String(raw.id);
  const firstName = raw.first_name?.trim() || "ChessPlayer";
  const lastName = raw.last_name?.trim() || null;
  const username = raw.username?.trim() || null;
  const avatarUrl = raw.photo_url?.trim() || null;
  const languageCode = normalizeLanguage(raw.language_code);
  const isSuperadmin = telegramId === env.SUPERADMIN_TELEGRAM_ID;

  await db
    .insert(users)
    .values({
      telegramId,
      username,
      firstName,
      lastName,
      avatarUrl,
      languageCode,
      isSuperadmin,
    })
    .onConflictDoUpdate({
      target: users.telegramId,
      set: {
        username,
        firstName,
        lastName,
        avatarUrl,
        isSuperadmin,
        updatedAt: new Date(),
      },
    });

  return {
    telegramId,
    username,
    firstName,
    lastName,
    avatarUrl,
    languageCode,
    isSuperadmin,
  };
}

const telegramAuthPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest("user", null as unknown as AuthenticatedTelegramUser);

  fastify.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith("tma ")) {
          if (env.ALLOW_MOCK_AUTH) {
            const mockId =
              (request.headers["x-mock-telegram-id"] as string | undefined) ||
              env.SUPERADMIN_TELEGRAM_ID;
            const mockUsername =
              (request.headers["x-mock-username"] as string | undefined) ||
              "MoZeR";
            request.user = await upsertUserRecord({
              id: mockId,
              first_name: mockUsername,
              username: mockUsername,
              language_code: "ru",
            });
            return;
          }
          return reply
            .code(401)
            .send({ error: "Missing or invalid authorization header" });
        }

        const initData = authHeader.slice(4).trim();
        if (!initData || initData === "mock") {
          if (env.ALLOW_MOCK_AUTH) {
            const mockId =
              (request.headers["x-mock-telegram-id"] as string | undefined) ||
              env.SUPERADMIN_TELEGRAM_ID;
            const mockUsername =
              (request.headers["x-mock-username"] as string | undefined) ||
              "MoZeR";
            request.user = await upsertUserRecord({
              id: mockId,
              first_name: mockUsername,
              username: mockUsername,
              language_code: "ru",
            });
            return;
          }
          return reply.code(401).send({ error: "Empty Telegram initData" });
        }

        const urlParams = new URLSearchParams(initData);
        const hash = urlParams.get("hash");

        if (!hash) {
          return reply
            .code(401)
            .send({ error: "Hash is missing from initData" });
        }

        if (!env.TELEGRAM_BOT_TOKEN) {
          if (env.ALLOW_MOCK_AUTH) {
            const userStr = urlParams.get("user");
            if (userStr) {
              const parsed = JSON.parse(userStr) as RawTelegramWebAppUser;
              request.user = await upsertUserRecord(parsed);
              return;
            }
          }
          return reply
            .code(500)
            .send({ error: "TELEGRAM_BOT_TOKEN is not configured" });
        }

        urlParams.delete("hash");
        const keys = Array.from(urlParams.keys()).sort();
        const dataCheckString = keys
          .map((key) => `${key}=${urlParams.get(key)}`)
          .join("\n");

        const secretKey = crypto
          .createHmac("sha256", "WebAppData")
          .update(env.TELEGRAM_BOT_TOKEN)
          .digest();

        const calculatedHash = crypto
          .createHmac("sha256", secretKey)
          .update(dataCheckString)
          .digest("hex");

        if (calculatedHash !== hash) {
          return reply
            .code(403)
            .send({ error: "Invalid initData signature" });
        }

        const userStr = urlParams.get("user");
        if (!userStr) {
          return reply
            .code(400)
            .send({ error: "User data missing in initData" });
        }

        const rawUser = JSON.parse(userStr) as RawTelegramWebAppUser;
        request.user = await upsertUserRecord(rawUser);
      } catch (err) {
        request.log.error(err, "[TelegramAuth] Authentication failed");
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    }
  );

  fastify.decorate(
    "requireSuperadmin",
    async (request: FastifyRequest, reply: FastifyReply) => {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;
      if (!request.user?.isSuperadmin) {
        return reply
          .code(403)
          .send({ error: "Forbidden: SuperAdmin access required" });
      }
    }
  );
};

export default fp(telegramAuthPlugin);

