import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

const queryClient = postgres(env.DATABASE_URL);
export const db = drizzle(queryClient, { schema });
export const sqlClient = queryClient;

/**
 * Seeds the default SuperAdmin idempotently on startup.
 * Schema DDL is managed exclusively via `PostgreSQL_Server/migrations/*.sql`.
 */
export async function ensureTeleAppSchemaAndSeed(): Promise<void> {
  // Seed SuperAdmin (5106981885)
  await sqlClient`
    INSERT INTO tele_app.users (telegram_id, username, first_name, language_code, is_superadmin)
    VALUES (${env.SUPERADMIN_TELEGRAM_ID}, 'MoZeR', 'MoZeR', 'ru', TRUE)
    ON CONFLICT (telegram_id) DO UPDATE SET is_superadmin = TRUE
  `;
}

