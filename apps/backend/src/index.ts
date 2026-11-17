import dns from "node:dns";
import net from "node:net";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { startTelegramBotBackgroundLoops } from "./bot/telegramBot.service.js";

// Prefer IPv4 and disable Node 20/24 Happy Eyeballs (internalConnectMultiple 250ms timeout)
// in Docker/Linux environments where IPv6 is unrouted, preventing AggregateError fetch failures to api.telegram.org
dns.setDefaultResultOrder("ipv4first");
if (typeof net.setDefaultAutoSelectFamily === "function") {
  net.setDefaultAutoSelectFamily(false);
}
import { env } from "./config/env.js";
import { ensureTeleAppSchemaAndSeed } from "./db/index.js";
import telegramAuthPlugin from "./plugins/telegramAuth.js";
import { cabinetRoutes } from "./routes/cabinet.routes.js";
import { challengesRoutes } from "./routes/challenges.routes.js";
import { clubsRoutes } from "./routes/clubs.routes.js";
import { engineRoutes } from "./routes/engine.routes.js";
import { superadminRoutes } from "./routes/superadmin.routes.js";

const server = Fastify({
  bodyLimit: 256 * 1024, // 256 KB strict request payload cap
  logger: {
    transport:
      env.NODE_ENV === "development"
        ? {
            target: "pino-pretty",
            options: {
              translateTime: "HH:MM:ss Z",
              ignore: "pid,hostname",
            },
          }
        : undefined,
  },
});

const allowedCorsOrigins = new Set<string>([
  env.MINI_APP_URL.replace(/\/+$/, ""),
  "https://web.telegram.org",
]);

async function bootstrap() {
  await server.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      const normalized = origin.replace(/\/+$/, "");
      if (
        allowedCorsOrigins.has(normalized) ||
        (env.NODE_ENV !== "production" &&
          (normalized.startsWith("http://localhost:") ||
            normalized.startsWith("http://127.0.0.1:")))
      ) {
        cb(null, true);
        return;
      }
      cb(new Error("Origin not allowed by CORS"), false);
    },
    credentials: true,
  });

  await server.register(telegramAuthPlugin);

  server.get("/api/health", async () => ({
    status: "ok",
    service: "extrapawn-mini-backend",
    timestamp: new Date().toISOString(),
  }));

  await server.register(cabinetRoutes, { prefix: "/api" });
  await server.register(challengesRoutes, { prefix: "/api" });
  await server.register(clubsRoutes, { prefix: "/api" });
  await server.register(superadminRoutes, { prefix: "/api" });
  await server.register(engineRoutes, { prefix: "/api" });

  await ensureTeleAppSchemaAndSeed();
  server.log.info("[Bootstrap] tele_app schema and seed verified.");

  await server.listen({ port: env.PORT, host: env.HOST });
  server.log.info(
    `[Bootstrap] ExtraPawn Mini App Backend listening on http://${env.HOST}:${env.PORT}`
  );

  startTelegramBotBackgroundLoops();
}

bootstrap().catch((err) => {
  server.log.error(err, "[Bootstrap] Fatal startup error");
  process.exit(1);
});

