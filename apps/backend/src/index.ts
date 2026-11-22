import "./config/networkBootstrap.js";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { startTelegramBotBackgroundLoops } from "./bot/telegramBot.service.js";
import { env } from "./config/env.js";
import {
  bindMiniLogger,
  buildMiniLoggerOptions,
  logger,
} from "./config/logger.js";
import { ensureTeleAppSchemaAndSeed } from "./db/index.js";
import telegramAuthPlugin, {
  type AuthenticatedTelegramUser,
} from "./plugins/telegramAuth.js";
import { cabinetRoutes } from "./routes/cabinet.routes.js";
import { challengesRoutes } from "./routes/challenges.routes.js";
import { clubsRoutes } from "./routes/clubs.routes.js";
import { engineRoutes } from "./routes/engine.routes.js";
import { superadminRoutes } from "./routes/superadmin.routes.js";
import { startPostgresDoctorLoop } from "./services/postgresDoctor.service.js";

const server = Fastify({
  bodyLimit: 256 * 1024, // 256 KB strict request payload cap
  logController: new Fastify.LogController({ disableRequestLogging: true }),
  logger: buildMiniLoggerOptions(),
});
bindMiniLogger(server.log);

server.addHook("onResponse", async (request, reply) => {
  const path = (request.url.split("?")[0] || request.url).trim();
  const statusCode = reply.statusCode;

  if (request.method === "OPTIONS" || (path === "/api/health" && statusCode === 200)) {
    return;
  }

  const durationMs = Math.round(reply.elapsedTime);
  const slowThresholdMs =
    path === "/api/coach-engine/uci_fen" || path.endsWith("/move") ? 1500 : 500;
  const authUser = request.user as AuthenticatedTelegramUser | undefined;
  const userId = authUser?.telegramId ?? "anonymous";
  const meta = {
    status: statusCode,
    duration_ms: durationMs,
    method: request.method,
    path,
    user: userId,
  };

  if (statusCode >= 500) {
    server.log.error(
      { ...meta, event: "http_5xx" },
      `[${statusCode}] ${durationMs}ms | ${request.method} ${path}`
    );
  } else if (statusCode === 403 || statusCode === 429) {
    server.log.warn(
      { ...meta, event: "http_rejected" },
      `[${statusCode}] ${durationMs}ms | ${request.method} ${path}`
    );
  } else if (durationMs > slowThresholdMs) {
    server.log.warn(
      { ...meta, event: "slow_request" },
      `Slow request [${statusCode}] ${durationMs}ms | ${request.method} ${path}`
    );
  } else {
    server.log.debug(
      meta,
      `[${statusCode}] ${durationMs}ms | ${request.method} ${path}`
    );
  }
});

server.setErrorHandler(async (error, request, reply) => {
  const errObj = error as Error & { statusCode?: number };
  const statusCode = errObj.statusCode ?? 500;
  if (statusCode >= 500) {
    request.log.error(
      { err: errObj, event: "unhandled_5xx", method: request.method, url: request.url },
      `Unhandled 5xx error on ${request.method} ${request.url}`
    );
    return reply.code(statusCode).send({ error: "Internal Server Error" });
  }
  return reply.send(error);
});

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error, event: "fatal_uncaught" }, "Uncaught exception, terminating process");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.fatal(
    { err: error, event: "fatal_unhandled_rejection" },
    "Unhandled rejection, terminating process"
  );
  process.exit(1);
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
  server.log.info({ event: "schema_ready" }, "tele_app schema and seed verified");

  await server.listen({ port: env.PORT, host: env.HOST });
  server.log.info(
    { event: "server_started", host: env.HOST, port: env.PORT },
    `ExtraPawn Mini App Backend listening on http://${env.HOST}:${env.PORT}`
  );

  startTelegramBotBackgroundLoops();
  startPostgresDoctorLoop();
}

bootstrap().catch((err) => {
  server.log.fatal({ err, event: "bootstrap_fatal" }, "Fatal startup error");
  process.exit(1);
});

