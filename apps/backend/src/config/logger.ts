import type {
  FastifyBaseLogger,
  FastifyServerOptions,
} from "fastify";
import { env } from "../config/env.js";

export type MiniLoggerOption = Exclude<
  FastifyServerOptions["logger"],
  boolean | undefined
>;

export type MiniLogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type LogMeta = Record<string, unknown>;

const LOG_LEVEL_WEIGHT: Record<MiniLogLevel, number> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export function resolveMiniLogLevel(): MiniLogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").trim().toLowerCase();
  if (raw === "warning") return "warn";
  if (
    raw === "debug" ||
    raw === "info" ||
    raw === "warn" ||
    raw === "error" ||
    raw === "fatal"
  ) {
    return raw;
  }
  throw new Error(
    `Invalid LOG_LEVEL "${raw}": expected debug|info|warn|error|fatal`
  );
}

export function buildMiniLoggerOptions(): MiniLoggerOption {
  const level = resolveMiniLogLevel();

  if (env.NODE_ENV === "development") {
    return {
      level,
      transport: {
        target: "pino-pretty",
        options: {
          translateTime: "HH:MM:ss Z",
          ignore: "pid,hostname,reqId",
          colorize: true,
        },
      },
    };
  }

  return {
    level,
    base: { service: "mini-backend" },
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    formatters: {
      level: (label: string) => ({
        level: label === "warn" ? "WARN" : label.toUpperCase(),
      }),
    },
  };
}

let boundLogger: FastifyBaseLogger | null = null;
const configuredLevel = resolveMiniLogLevel();

export function bindMiniLogger(instance: FastifyBaseLogger): void {
  boundLogger = instance;
}

function emit(
  level: MiniLogLevel,
  metaOrMsg: LogMeta | string,
  msg?: string
): void {
  if (boundLogger) {
    if (typeof metaOrMsg === "string") {
      boundLogger[level](metaOrMsg);
    } else {
      boundLogger[level](metaOrMsg, msg);
    }
    return;
  }

  if (LOG_LEVEL_WEIGHT[level] < LOG_LEVEL_WEIGHT[configuredLevel]) {
    return;
  }

  const payload: LogMeta = {
    ts: new Date().toISOString(),
    level: level === "warn" ? "WARN" : level.toUpperCase(),
    service: "mini-backend",
    ...(typeof metaOrMsg === "string"
      ? { msg: metaOrMsg }
      : { ...metaOrMsg, ...(msg !== undefined ? { msg } : {}) }),
  };

  const line = JSON.stringify(payload);
  if (level === "error" || level === "fatal") {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export const logger = {
  debug: (metaOrMsg: LogMeta | string, msg?: string): void =>
    emit("debug", metaOrMsg, msg),
  info: (metaOrMsg: LogMeta | string, msg?: string): void =>
    emit("info", metaOrMsg, msg),
  warn: (metaOrMsg: LogMeta | string, msg?: string): void =>
    emit("warn", metaOrMsg, msg),
  error: (metaOrMsg: LogMeta | string, msg?: string): void =>
    emit("error", metaOrMsg, msg),
  fatal: (metaOrMsg: LogMeta | string, msg?: string): void =>
    emit("fatal", metaOrMsg, msg),
};
