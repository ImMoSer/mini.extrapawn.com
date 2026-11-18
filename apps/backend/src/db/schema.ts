import {
  bigint,
  boolean,
  customType,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type { WeeklyScheduleConfig } from "shared";

export const teleAppSchema = pgSchema("tele_app");

const pgBigintString = customType<{
  data: string;
  driverData: string | number;
}>({
  dataType() {
    return "bigint";
  },
  fromDriver(value: string | number): string {
    return String(value);
  },
});

export const users = teleAppSchema.table("users", {
  telegramId: pgBigintString("telegram_id").primaryKey(),
  username: text("username"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  avatarUrl: text("avatar_url"),
  languageCode: text("language_code").notNull().default("ru"),
  isSuperadmin: boolean("is_superadmin").notNull().default(false),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const clubs = teleAppSchema.table("clubs", {
  chatId: pgBigintString("chat_id").primaryKey(),
  title: text("title").notNull(),
  username: text("username"),
  inviteLink: text("invite_link"),
  ownerTelegramId: pgBigintString("owner_telegram_id")
    .notNull()
    .references(() => users.telegramId),
  topicThreadId: integer("topic_thread_id").notNull(),
  memberCount: integer("member_count").notNull().default(0),
  language: text("language").notNull().default("ru"),
  timezone: text("timezone").notNull().default("Europe/Berlin"),
  topicMessageIds: integer("topic_message_ids")
    .array()
    .notNull()
    .default([]),
  status: text("status").notNull().default("active"),
  isActive: boolean("is_active").notNull().default(true),
  autoPaused: boolean("auto_paused").notNull().default(false),
  autoPauseChallengeId: integer("auto_pause_challenge_id"),
  autoPauseMessageId: integer("auto_pause_message_id"),
  weeklySchedule: jsonb("weekly_schedule").$type<WeeklyScheduleConfig>(),
  blockedReason: text("blocked_reason"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  scheduleTimes: text("schedule_times")
    .array()
    .notNull()
    .default(["09:00", "15:00", "20:00"]),
  filterDisciplines: text("filter_disciplines")
    .array()
    .notNull()
    .default([
      "tactics",
      "theoretical_endgames",
      "practical_chess",
      "finishhim",
    ]),
  filterDifficulties: text("filter_difficulties")
    .array()
    .notNull()
    .default(["Novice", "Pro", "Master"]),
  filterFocusGroup: text("filter_focus_group").notNull().default("all"),
  filterFocusKeys: text("filter_focus_keys")
    .array()
    .notNull()
    .default(["all"]),
  filterObjective: text("filter_objective").notNull().default("all"),
  lastPublishedAt: timestamp("last_published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const clubAdmins = teleAppSchema.table(
  "club_admins",
  {
    chatId: pgBigintString("chat_id")
      .notNull()
      .references(() => clubs.chatId, { onDelete: "cascade" }),
    telegramId: pgBigintString("telegram_id")
      .notNull()
      .references(() => users.telegramId, { onDelete: "cascade" }),
    role: text("role").notNull().default("admin"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chatId, table.telegramId] }),
  })
);

export const clubChallenges = teleAppSchema.table(
  "club_challenges",
  {
    id: serial("id").primaryKey(),
    chatId: pgBigintString("chat_id")
      .notNull()
      .references(() => clubs.chatId, { onDelete: "cascade" }),
    discipline: text("discipline").notNull(),
    puzzleId: text("puzzle_id").notNull(),
    edition: text("edition").notNull().default("0"),
    difficulty: text("difficulty").notNull().default("Novice"),
    botEngine: text("bot_engine").notNull().default("mozero"),
    initialFen: text("initial_fen").notNull(),
    puzzleFen: text("puzzle_fen").notNull(),
    userColor: text("user_color").notNull(),
    firstMove: text("first_move").notNull(),
    strategy: text("strategy").notNull(),
    objective: text("objective").notNull().default("win"),
    tacticalSolution: text("tactical_solution").notNull().default(""),
    domain: text("domain").notNull().default(""),
    category: text("category").notNull().default(""),
    tgMessageId: integer("tg_message_id"),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqueClubPuzzleEdition: unique().on(
      table.chatId,
      table.discipline,
      table.puzzleId,
      table.edition
    ),
  })
);

export const challengeAttempts = teleAppSchema.table(
  "challenge_attempts",
  {
    id: serial("id").primaryKey(),
    chatId: pgBigintString("chat_id")
      .notNull()
      .references(() => clubs.chatId, { onDelete: "cascade" }),
    discipline: text("discipline").notNull(),
    puzzleId: text("puzzle_id").notNull(),
    edition: text("edition").notNull().default("0"),
    telegramId: pgBigintString("telegram_id")
      .notNull()
      .references(() => users.telegramId, { onDelete: "cascade" }),
    username: text("username").notNull(),
    status: text("status").notNull().default("in_progress"),
    solved: boolean("solved").notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    solvedTimeMs: bigint("solved_time_ms", { mode: "number" }),
    uciMoves: text("uci_moves").notNull().default(""),
    pgnMoves: text("pgn_moves").notNull().default(""),
    moveTimesMs: integer("move_times_ms").array(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    attemptStartedAt: timestamp("attempt_started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    uniqueUserAttempt: unique().on(
      table.chatId,
      table.discipline,
      table.puzzleId,
      table.edition,
      table.telegramId
    ),
  })
);

export const postgresDoctorHeartbeat = pgTable("postgres_doctor_heartbeat", {
  id: smallint("id").primaryKey().default(1),
  lastBackupAt: timestamp("last_backup_at", { withTimezone: true }),
  lastBackupSizeBytes: bigint("last_backup_size_bytes", { mode: "number" }),
  lastBackupFile: text("last_backup_file"),
  lastVacuumAt: timestamp("last_vacuum_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const promoCampaigns = teleAppSchema.table("promo_campaigns", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  fileId: text("file_id"),
  textRu: text("text_ru").notNull(),
  textEn: text("text_en").notNull(),
  textDe: text("text_de").notNull().default(""),
  buttonRu: text("button_ru"),
  buttonEn: text("button_en"),
  buttonDe: text("button_de"),
  targetUrl: text("target_url"),
  imageUrl: text("image_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
