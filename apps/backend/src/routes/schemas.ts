/**
 * Runtime Fastify JSON Schemas for all Mini App HTTP endpoints.
 * Prevents malformed payloads, NaN injections, and oversized memory allocations before handlers execute.
 */

const DISCIPLINE_ENUM = [
  "tactics",
  "theoretical_endgames",
  "practical_chess",
  "finishhim",
] as const;

const DIFFICULTY_ENUM = ["Novice", "Pro", "Master"] as const;
const LANGUAGE_ENUM = ["ru", "en", "de"] as const;

export const challengeParamsSchema = {
  type: "object",
  required: ["discipline", "puzzleId", "edition", "chatId"],
  additionalProperties: false,
  properties: {
    discipline: { type: "string", enum: DISCIPLINE_ENUM },
    puzzleId: { type: "string", minLength: 1, maxLength: 64 },
    edition: { type: "string", minLength: 1, maxLength: 32 },
    chatId: { type: "string", pattern: "^-?[0-9]{1,20}$" },
  },
} as const;

export const chatIdParamsSchema = {
  type: "object",
  required: ["chatId"],
  additionalProperties: false,
  properties: {
    chatId: { type: "string", pattern: "^-?[0-9]{1,20}$" },
  },
} as const;

export const attemptIdParamsSchema = {
  type: "object",
  required: ["attemptId"],
  additionalProperties: false,
  properties: {
    attemptId: { type: "string", pattern: "^[0-9]{1,12}$" },
  },
} as const;

export const submitAttemptBodySchema = {
  type: "object",
  required: ["solved", "time_ms"],
  additionalProperties: false,
  properties: {
    solved: { type: "boolean" },
    time_ms: { type: "number", minimum: 0, maximum: 86_400_000 },
    uci_moves: { type: "string", maxLength: 4096 },
    pgn_moves: { type: "string", maxLength: 8192 },
    move_times_ms: {
      type: "array",
      maxItems: 500,
      items: { type: "number", minimum: 0, maximum: 600_000 },
    },
  },
} as const;

export const cabinetLanguageBodySchema = {
  type: "object",
  required: ["language_code"],
  additionalProperties: false,
  properties: {
    language_code: { type: "string", enum: LANGUAGE_ENUM },
  },
} as const;

export const onboardingLanguageBodySchema = {
  type: "object",
  required: ["language"],
  additionalProperties: false,
  properties: {
    language: { type: "string", enum: LANGUAGE_ENUM },
  },
} as const;

export const toggleClubActiveBodySchema = {
  type: "object",
  required: ["is_active"],
  additionalProperties: false,
  properties: {
    is_active: { type: "boolean" },
  },
} as const;

export const updateClubSettingsBodySchema = {
  type: "object",
  required: ["weekly_schedule"],
  additionalProperties: true,
  properties: {
    is_active: { type: "boolean" },
    language: { type: "string", enum: LANGUAGE_ENUM },
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    status: { type: "string", enum: ["active", "paused"] },
    weekly_schedule: { type: "object" },
    schedule_times: {
      type: "array",
      maxItems: 24,
      items: { type: "string", maxLength: 16 },
    },
    filter_disciplines: {
      type: "array",
      maxItems: 8,
      items: { type: "string", enum: DISCIPLINE_ENUM },
    },
    filter_difficulties: {
      type: "array",
      maxItems: 4,
      items: { type: "string", enum: DIFFICULTY_ENUM },
    },
    filter_focus_group: { type: "string", maxLength: 64 },
    filter_focus_keys: {
      type: "array",
      maxItems: 32,
      items: { type: "string", maxLength: 64 },
    },
    filter_objective: { type: "string", maxLength: 32 },
  },
} as const;

export const publishNowBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    discipline: { type: "string", enum: DISCIPLINE_ENUM },
    difficulty: { type: "string", enum: DIFFICULTY_ENUM },
    focusGroup: { type: "string", maxLength: 64 },
    focusKey: { type: "string", maxLength: 64 },
    objective: { type: "string", maxLength: 32 },
    puzzleId: { type: "string", maxLength: 64 },
  },
} as const;

export const engineBestmoveBodySchema = {
  type: "object",
  required: ["engine", "start_fen", "moves"],
  additionalProperties: false,
  properties: {
    engine: { type: "string", enum: ["mozero"] },
    start_fen: { type: "string", minLength: 1, maxLength: 120 },
    moves: {
      type: "array",
      maxItems: 500,
      items: { type: "string", minLength: 4, maxLength: 8 },
    },
  },
} as const;

export const engineGaviotaBodySchema = {
  type: "object",
  required: ["fen"],
  additionalProperties: false,
  properties: {
    fen: { type: "string", minLength: 1, maxLength: 120 },
    max_candidates: { type: "integer", minimum: 1, maximum: 16 },
    include_pv: { type: "boolean" },
  },
} as const;

export const coachUciFenBodySchema = {
  type: "object",
  required: ["start_fen"],
  additionalProperties: false,
  properties: {
    user_id: { type: "string", maxLength: 64 },
    start_fen: { type: "string", minLength: 1, maxLength: 120 },
    moves: {
      type: "array",
      maxItems: 500,
      items: { type: "string", minLength: 4, maxLength: 8 },
    },
  },
} as const;

export const superadminBlockBodySchema = {
  type: "object",
  required: ["blocked"],
  additionalProperties: false,
  properties: {
    blocked: { type: "boolean" },
    blocked_reason: { type: ["string", "null"], maxLength: 500 },
  },
} as const;

export const superadminStatusBodySchema = {
  type: "object",
  required: ["status"],
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: [
        "pending",
        "active",
        "paused",
        "blocked",
        "bot_removed",
        "below_threshold",
      ],
    },
    blocked_reason: { type: ["string", "null"], maxLength: 500 },
    leave_chat: { type: "boolean" },
  },
} as const;

export const superadminPromoBodySchema = {
  type: "object",
  required: ["title", "text_ru", "text_en", "text_de"],
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1, maxLength: 200 },
    file_id: { type: ["string", "null"], maxLength: 300 },
    text_ru: { type: "string", minLength: 1, maxLength: 4096 },
    text_en: { type: "string", minLength: 1, maxLength: 4096 },
    text_de: { type: "string", minLength: 1, maxLength: 4096 },
    button_ru: { type: ["string", "null"], maxLength: 120 },
    button_en: { type: ["string", "null"], maxLength: 120 },
    button_de: { type: ["string", "null"], maxLength: 120 },
    target_url: { type: ["string", "null"], maxLength: 500 },
    broadcast_now: { type: "boolean" },
  },
} as const;
