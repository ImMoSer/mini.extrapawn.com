import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  DEFAULT_CLUB_CHAT_ID,
  DEFAULT_CLUB_INVITE_URL,
  DEFAULT_CLUB_THREAD_ID,
  DEFAULT_CLUB_TITLE,
  SUPERADMIN_TELEGRAM_ID,
} from "shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load root .env_local or .env if present
dotenv.config({ path: path.resolve(__dirname, "../../../../.env_local") });
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

function requireEnv(name: string, defaultValue?: string): string {
  const val = process.env[name]?.trim() || defaultValue;
  if (!val) {
    throw new Error(`[Config] Missing required environment variable: ${name}`);
  }
  return val;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.PORT || 3000),
  HOST: process.env.HOST || "0.0.0.0",
  DATABASE_URL: requireEnv(
    "DATABASE_URL",
    "postgres://postgres:postgres_password_123@localhost:5432/chess_db"
  ),
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN?.trim() || "",
  BOT_USERNAME: process.env.BOT_USERNAME?.trim() || "ExtraPawnTeleBot",
  MINI_APP_URL: requireEnv("MINI_APP_URL", "https://mini.extrapawn.com"),
  PUZZLE_SERVICE_URL: requireEnv(
    "PUZZLE_SERVICE_URL",
    "http://localhost:8081"
  ),
  MAIA_HUB_URL: requireEnv("MAIA_HUB_URL", "http://localhost:5002"),
  TABLESERVICE_URL: requireEnv("TABLESERVICE_URL", "http://localhost:5001"),
  SUPERADMIN_TELEGRAM_ID:
    process.env.SUPERADMIN_TELEGRAM_ID?.trim() || SUPERADMIN_TELEGRAM_ID,
  DEFAULT_CLUB_CHAT_ID:
    process.env.DEFAULT_CLUB_CHAT_ID?.trim() || DEFAULT_CLUB_CHAT_ID,
  DEFAULT_CLUB_THREAD_ID: Number(
    process.env.DEFAULT_CLUB_THREAD_ID || DEFAULT_CLUB_THREAD_ID
  ),
  DEFAULT_CLUB_TITLE:
    process.env.DEFAULT_CLUB_TITLE?.trim() || DEFAULT_CLUB_TITLE,
  DEFAULT_CLUB_INVITE_URL:
    process.env.DEFAULT_CLUB_INVITE_URL?.trim() || DEFAULT_CLUB_INVITE_URL,
  ALLOW_MOCK_AUTH:
    process.env.ALLOW_MOCK_AUTH === "true" ||
    process.env.NODE_ENV !== "production",
};

