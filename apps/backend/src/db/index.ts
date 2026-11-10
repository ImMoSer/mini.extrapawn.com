import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

const queryClient = postgres(env.DATABASE_URL);
export const db = drizzle(queryClient, { schema });
export const sqlClient = queryClient;

/**
 * Ensures the `tele_app` schema, tables, and default seed data exist,
 * and drops the legacy `puzzle_service.challenge_attempts` table if still present.
 */
export async function ensureTeleAppSchemaAndSeed(): Promise<void> {
  await sqlClient.unsafe(`
    DROP TABLE IF EXISTS puzzle_service.challenge_attempts CASCADE;
    CREATE SCHEMA IF NOT EXISTS tele_app;

    CREATE TABLE IF NOT EXISTS tele_app.users (
      telegram_id   BIGINT PRIMARY KEY,
      username      TEXT,
      first_name    TEXT NOT NULL,
      last_name     TEXT,
      avatar_url    TEXT,
      language_code TEXT NOT NULL DEFAULT 'ru',
      is_superadmin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tele_app.clubs (
      chat_id                BIGINT PRIMARY KEY,
      title                  TEXT NOT NULL,
      username               TEXT,
      invite_link            TEXT,
      owner_telegram_id      BIGINT NOT NULL REFERENCES tele_app.users(telegram_id),
      topic_thread_id        INTEGER NOT NULL,
      member_count           INTEGER NOT NULL DEFAULT 0,
      language               TEXT NOT NULL DEFAULT 'ru',
      timezone               TEXT NOT NULL DEFAULT 'Europe/Berlin',
      status                 TEXT NOT NULL DEFAULT 'active',
      is_active              BOOLEAN NOT NULL DEFAULT TRUE,
      auto_paused            BOOLEAN NOT NULL DEFAULT FALSE,
      auto_pause_challenge_id INTEGER,
      weekly_schedule        JSONB,
      blocked_reason         TEXT,
      is_default             BOOLEAN NOT NULL DEFAULT FALSE,
      terms_accepted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      schedule_times         TEXT[] NOT NULL DEFAULT '{09:00,15:00,20:00}',
      leaderboard_cron_days  INTEGER NOT NULL DEFAULT 3,
      filter_disciplines     TEXT[] NOT NULL DEFAULT '{tactics,theoretical_endgames,practical_chess,finishhim}',
      filter_difficulties    TEXT[] NOT NULL DEFAULT '{Novice,Pro,Master}',
      filter_focus_group     TEXT NOT NULL DEFAULT 'all',
      filter_focus_keys      TEXT[] NOT NULL DEFAULT '{all}',
      filter_objective       TEXT NOT NULL DEFAULT 'all',
      last_published_at      TIMESTAMPTZ,
      last_leaderboard_at    TIMESTAMPTZ,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE tele_app.clubs ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE tele_app.clubs ADD COLUMN IF NOT EXISTS auto_paused BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE tele_app.clubs ADD COLUMN IF NOT EXISTS auto_pause_challenge_id INTEGER;
    ALTER TABLE tele_app.clubs ADD COLUMN IF NOT EXISTS weekly_schedule JSONB;

    CREATE TABLE IF NOT EXISTS tele_app.club_admins (
      chat_id     BIGINT NOT NULL REFERENCES tele_app.clubs(chat_id) ON DELETE CASCADE,
      telegram_id BIGINT NOT NULL REFERENCES tele_app.users(telegram_id) ON DELETE CASCADE,
      role        TEXT NOT NULL DEFAULT 'admin',
      PRIMARY KEY (chat_id, telegram_id)
    );

    CREATE TABLE IF NOT EXISTS tele_app.club_challenges (
      id                SERIAL PRIMARY KEY,
      chat_id           BIGINT NOT NULL REFERENCES tele_app.clubs(chat_id) ON DELETE CASCADE,
      discipline        TEXT NOT NULL,
      puzzle_id         TEXT NOT NULL,
      edition           TEXT NOT NULL DEFAULT '0',
      difficulty        TEXT NOT NULL DEFAULT 'Novice',
      bot_engine        TEXT NOT NULL DEFAULT 'maia-1500',
      initial_fen       TEXT NOT NULL,
      puzzle_fen        TEXT NOT NULL,
      user_color        TEXT NOT NULL,
      first_move        TEXT NOT NULL,
      strategy          TEXT NOT NULL,
      objective         TEXT NOT NULL DEFAULT 'win',
      tactical_solution TEXT NOT NULL DEFAULT '',
      domain            TEXT NOT NULL DEFAULT '',
      category          TEXT NOT NULL DEFAULT '',
      tg_message_id     INTEGER,
      published_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (chat_id, discipline, puzzle_id, edition)
    );

    CREATE TABLE IF NOT EXISTS tele_app.challenge_attempts (
      id              SERIAL PRIMARY KEY,
      chat_id         BIGINT NOT NULL REFERENCES tele_app.clubs(chat_id) ON DELETE CASCADE,
      discipline      TEXT NOT NULL,
      puzzle_id       TEXT NOT NULL,
      edition         TEXT NOT NULL DEFAULT '0',
      telegram_id     BIGINT NOT NULL REFERENCES tele_app.users(telegram_id) ON DELETE CASCADE,
      username        TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'in_progress',
      solved          BOOLEAN NOT NULL DEFAULT FALSE,
      attempts        INTEGER NOT NULL DEFAULT 0,
      solved_time_ms  BIGINT,
      uci_moves       TEXT NOT NULL DEFAULT '',
      pgn_moves       TEXT NOT NULL DEFAULT '',
      notified_at     TIMESTAMPTZ,
      started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at    TIMESTAMPTZ,
      UNIQUE (chat_id, discipline, puzzle_id, edition, telegram_id)
    );

    CREATE TABLE IF NOT EXISTS tele_app.promo_campaigns (
      id          SERIAL PRIMARY KEY,
      title       TEXT NOT NULL,
      text_ru     TEXT NOT NULL,
      text_en     TEXT NOT NULL,
      button_ru   TEXT,
      button_en   TEXT,
      target_url  TEXT,
      image_url   TEXT,
      is_active   BOOLEAN NOT NULL DEFAULT TRUE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

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

