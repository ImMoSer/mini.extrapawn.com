import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

const queryClient = postgres(env.DATABASE_URL);
export const db = drizzle(queryClient, { schema });
export const sqlClient = queryClient;

/**
 * Seeds the default SuperAdmin and default club (`EXTRAPAWNCLUB`) idempotently on startup.
 * Schema DDL is managed exclusively via `PostgreSQL_Server/migrations/*.sql`.
 */
export async function ensureTeleAppSchemaAndSeed(): Promise<void> {
  // Seed SuperAdmin (5106981885) and Default Club EXTRAPAWNCLUB (-1002255301933, thread 293770)
  await sqlClient`
    INSERT INTO tele_app.users (telegram_id, username, first_name, language_code, is_superadmin)
    VALUES (${env.SUPERADMIN_TELEGRAM_ID}, 'MoZeR', 'MoZeR', 'ru', TRUE)
    ON CONFLICT (telegram_id) DO UPDATE SET is_superadmin = TRUE
  `;

  await sqlClient`
    INSERT INTO tele_app.clubs (
      chat_id,
      title,
      username,
      invite_link,
      owner_telegram_id,
      topic_thread_id,
      member_count,
      language,
      timezone,
      status,
      is_default
    )
    VALUES (
      ${env.DEFAULT_CLUB_CHAT_ID},
      ${env.DEFAULT_CLUB_TITLE},
      'EXTRAPAWNCLUB',
      ${env.DEFAULT_CLUB_INVITE_URL},
      ${env.SUPERADMIN_TELEGRAM_ID},
      ${env.DEFAULT_CLUB_THREAD_ID},
      100,
      'ru',
      'Europe/Berlin',
      'active',
      TRUE
    )
    ON CONFLICT (chat_id) DO UPDATE
    SET topic_thread_id = EXCLUDED.topic_thread_id,
        is_default = TRUE
  `;

  await sqlClient`
    INSERT INTO tele_app.club_admins (chat_id, telegram_id, role)
    VALUES (${env.DEFAULT_CLUB_CHAT_ID}, ${env.SUPERADMIN_TELEGRAM_ID}, 'owner')
    ON CONFLICT (chat_id, telegram_id) DO UPDATE SET role = 'owner'
  `;
}

