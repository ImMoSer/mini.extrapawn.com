// ============================================================================
// ExtraPawn Telegram Mini App (`mini.extrapawn.com`) — Shared Domain Types
// ============================================================================

export const SUPERADMIN_TELEGRAM_ID = "5106981885";
export const DEFAULT_CLUB_CHAT_ID = "-1002255301933";
export const DEFAULT_CLUB_THREAD_ID = 293770;
export const DEFAULT_CLUB_TITLE = "EXTRAPAWNCLUB";
export const DEFAULT_CLUB_INVITE_URL = "https://t.me/EXTRAPAWNCLUB/1";
export const MAX_OWNED_CLUBS_PER_USER = 2;

export type AppLanguage = "ru" | "en" | "de";

export const OFFICIAL_CLUB_INVITE_URLS: Record<AppLanguage, string> = {
  ru: "https://t.me/EXTRAPAWNCLUB/1",
  en: "https://t.me/EXTRAPAWNCLUB/293806",
  de: "https://t.me/EXTRAPAWNCLUB/293807",
};

export function getOfficialClubInviteUrl(lang: AppLanguage): string {
  return OFFICIAL_CLUB_INVITE_URLS[lang] ?? OFFICIAL_CLUB_INVITE_URLS.ru;
}

export type DayOfWeekKey =
  | "mon"
  | "tue"
  | "wed"
  | "thu"
  | "fri"
  | "sat"
  | "sun";

export const ALL_DAYS_OF_WEEK: readonly DayOfWeekKey[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

export type ScheduleIntervalMinutes = 10 | 15 | 30 | 60;

export const ALL_SCHEDULE_INTERVALS: readonly ScheduleIntervalMinutes[] = [
  10, 15, 30, 60,
] as const;

export type ChallengeDiscipline =
  | "tactics"
  | "theoretical_endgames"
  | "practical_chess"
  | "finishhim";

export const ALL_CHALLENGE_DISCIPLINES: readonly ChallengeDiscipline[] = [
  "tactics",
  "theoretical_endgames",
  "practical_chess",
  "finishhim",
] as const;

export type ChallengeDifficulty = "Novice" | "Pro" | "Master";

export const ALL_CHALLENGE_DIFFICULTIES: readonly ChallengeDifficulty[] = [
  "Novice",
  "Pro",
  "Master",
] as const;

export type BotEngineId = "maia-1500" | "maia-2200" | "mozero";

export type ChallengeAttemptStatus = "in_progress" | "solved" | "surrendered";

export type ClubStatus =
  | "active"
  | "paused"
  | "blocked"
  | "bot_removed"
  | "below_threshold";

export type PuzzleObjective = "win" | "hold_draw";
export type PuzzleStrategyType = "scenarioOnly" | "scenarioPlus" | "playOutOnly";

export interface WarmupFocusTile {
  id: string;
  focusGroup: string;
  focusKey: string;
  labelRu: string;
  labelEn: string;
  labelDe: string;
}

export const TACTICS_WARMUP_TILES: readonly WarmupFocusTile[] = [
  { id: "mix", focusGroup: "all", focusKey: "all", labelRu: "MIX", labelEn: "MIX", labelDe: "MIX" },
  { id: "opening", focusGroup: "phase", focusKey: "opening", labelRu: "Дебют", labelEn: "Opening", labelDe: "Eröffnung" },
  { id: "middlegame", focusGroup: "phase", focusKey: "middlegame", labelRu: "Миттельшпиль", labelEn: "Middlegame", labelDe: "Mittelspiel" },
  { id: "endgame", focusGroup: "phase", focusKey: "endgame", labelRu: "Эндшпиль", labelEn: "Endgame", labelDe: "Endspiel" },
  { id: "attack", focusGroup: "motif", focusKey: "kingsideAttack", labelRu: "Атака", labelEn: "Attack", labelDe: "Angriff" },
  { id: "defense", focusGroup: "motif", focusKey: "defensiveMove", labelRu: "Защита", labelEn: "Defense", labelDe: "Verteidigung" },
  { id: "sacrifice", focusGroup: "motif", focusKey: "sacrifice", labelRu: "Жертва", labelEn: "Sacrifice", labelDe: "Opfer" },
  { id: "mate", focusGroup: "goal", focusKey: "mate", labelRu: "Мат", labelEn: "Checkmate", labelDe: "Matt" },
  { id: "crushing", focusGroup: "goal", focusKey: "crushing", labelRu: "Разгром", labelEn: "Crushing", labelDe: "Vernichtend" },
  { id: "advantage", focusGroup: "goal", focusKey: "advantage", labelRu: "Перевес", labelEn: "Advantage", labelDe: "Vorteil" },
];

export const THEORETICAL_WARMUP_TILES: readonly WarmupFocusTile[] = [
  { id: "mix", focusGroup: "all", focusKey: "all", labelRu: "MIX", labelEn: "MIX", labelDe: "MIX" },
  { id: "draw", focusGroup: "objective", focusKey: "hold_draw", labelRu: "Ничья", labelEn: "Hold Draw", labelDe: "Remis halten" },
  { id: "win", focusGroup: "objective", focusKey: "win", labelRu: "Победа", labelEn: "Win", labelDe: "Gewinn" },
  { id: "pawn", focusGroup: "domain", focusKey: "PAWN", labelRu: "Пешечник", labelEn: "Pawn Ending", labelDe: "Bauernendspiel" },
  { id: "rook", focusGroup: "domain", focusKey: "ROOK", labelRu: "Ладейник", labelEn: "Rook Ending", labelDe: "Turmendspiel" },
  { id: "bishop", focusGroup: "domain", focusKey: "BISHOP", labelRu: "Слоновый", labelEn: "Bishop Ending", labelDe: "Läuferendspiel" },
  { id: "knight", focusGroup: "domain", focusKey: "KNIGHT", labelRu: "Коневой", labelEn: "Knight Ending", labelDe: "Springerendspiel" },
  { id: "queen", focusGroup: "domain", focusKey: "QUEEN", labelRu: "Ферзевый", labelEn: "Queen Ending", labelDe: "Damenendspiel" },
  { id: "complex", focusGroup: "domain", focusKey: "COMPLEX", labelRu: "Сложный", labelEn: "Complex Ending", labelDe: "Komplexes Endspiel" },
];

export const PRACTICAL_WARMUP_TILES: readonly WarmupFocusTile[] = [
  { id: "mix", focusGroup: "all", focusKey: "all", labelRu: "MIX", labelEn: "MIX", labelDe: "MIX" },
  { id: "pawn", focusGroup: "domain", focusKey: "PAWN", labelRu: "Пешечник", labelEn: "Pawn Ending", labelDe: "Bauernendspiel" },
  { id: "rook", focusGroup: "domain", focusKey: "ROOK", labelRu: "Ладейник", labelEn: "Rook Ending", labelDe: "Turmendspiel" },
  { id: "bishop", focusGroup: "domain", focusKey: "BISHOP", labelRu: "Слоновый", labelEn: "Bishop Ending", labelDe: "Läuferendspiel" },
  { id: "knight", focusGroup: "domain", focusKey: "KNIGHT", labelRu: "Коневой", labelEn: "Knight Ending", labelDe: "Springerendspiel" },
  { id: "queen", focusGroup: "domain", focusKey: "QUEEN", labelRu: "Ферзевый", labelEn: "Queen Ending", labelDe: "Damenendspiel" },
  { id: "complex", focusGroup: "domain", focusKey: "COMPLEX", labelRu: "Сложный", labelEn: "Complex Ending", labelDe: "Komplexes Endspiel" },
  { id: "extra", focusGroup: "domain", focusKey: "EXTRA", labelRu: "EXTRAPAWN", labelEn: "EXTRAPAWN", labelDe: "EXTRAPAWN" },
];

export const ENDGAME_CLASS_TO_DOMAIN: Readonly<Record<string, string>> = {
  pawnending: "PAWN",
  knightending: "KNIGHT",
  knightvspawns: "KNIGHT",
  twoknightsvspawn: "KNIGHT",
  bishopvspawns: "BISHOP",
  oppositecolorbishops: "BISHOP",
  samecolorbishops: "BISHOP",
  twobishopsending: "BISHOP",
  doublerookending: "ROOK",
  rookending: "ROOK",
  rookvspawns: "ROOK",
  queenending: "QUEEN",
  queenvspawns: "QUEEN",
  bishopknightending: "COMPLEX",
  bishopvsknight: "COMPLEX",
  mixending: "COMPLEX",
  queenbishopvsqueen: "COMPLEX",
  queenknightvsqueen: "COMPLEX",
  queenminorvsqueenminor: "COMPLEX",
  queenrookending: "COMPLEX",
  queenvsminors: "COMPLEX",
  queenvsrook: "COMPLEX",
  queenvsrookminor: "COMPLEX",
  queenvstworooks: "COMPLEX",
  rookminorvsrook: "COMPLEX",
  rookminorvsrookminor: "COMPLEX",
  rookvsminor: "COMPLEX",
  rookvstwomenors: "COMPLEX",
  rookvstwominors: "COMPLEX",
  extrapawn: "EXTRA",
};

export function getWarmupTilesForDiscipline(
  discipline: ChallengeDiscipline
): readonly WarmupFocusTile[] {
  if (discipline === "tactics") {
    return TACTICS_WARMUP_TILES;
  }
  if (discipline === "theoretical_endgames") {
    return THEORETICAL_WARMUP_TILES;
  }
  return PRACTICAL_WARMUP_TILES;
}

export function getWarmupTileLabel(
  tile: WarmupFocusTile,
  lang: AppLanguage
): string {
  if (lang === "en") return tile.labelEn;
  if (lang === "de") return tile.labelDe;
  return tile.labelRu;
}

export function resolveCanonicalFocusKey(
  discipline: ChallengeDiscipline,
  rawCategoryOrKey: string | null | undefined
): string {
  const raw = (rawCategoryOrKey ?? "").trim();
  if (!raw || raw.toLowerCase() === "all" || raw.toLowerCase() === "mix") {
    return "all";
  }

  const lower = raw.toLowerCase();
  const mappedDomain = ENDGAME_CLASS_TO_DOMAIN[lower];
  const candidate = mappedDomain ?? raw;
  const candidateLower = candidate.toLowerCase();

  const tiles = getWarmupTilesForDiscipline(discipline);
  const matched = tiles.find(
    (t) =>
      t.focusKey.toLowerCase() === candidateLower ||
      t.id.toLowerCase() === candidateLower
  );

  if (matched) {
    return matched.focusKey;
  }

  // Fallback check across all tiles if a cross-discipline key was stored
  const anyTile = [
    ...TACTICS_WARMUP_TILES,
    ...THEORETICAL_WARMUP_TILES,
    ...PRACTICAL_WARMUP_TILES,
  ].find(
    (t) =>
      t.focusKey.toLowerCase() === candidateLower ||
      t.id.toLowerCase() === candidateLower
  );

  if (anyTile) {
    const validInDiscipline = tiles.find(
      (t) => t.focusKey.toLowerCase() === anyTile.focusKey.toLowerCase()
    );
    return validInDiscipline ? validInDiscipline.focusKey : "all";
  }

  return "all";
}

export function formatFocusLabel(
  discipline: ChallengeDiscipline,
  rawCategoryOrKey: string | null | undefined,
  lang: AppLanguage
): string {
  const canonicalKey = resolveCanonicalFocusKey(discipline, rawCategoryOrKey);
  const tiles = getWarmupTilesForDiscipline(discipline);
  const matched =
    tiles.find((t) => t.focusKey === canonicalKey) ?? tiles[0];
  if (!matched) {
    return "MIX";
  }
  return getWarmupTileLabel(matched, lang);
}

export interface ClubScheduleSlot {
  id: string;
  from_hour: number;
  to_hour: number;
  interval_minutes: ScheduleIntervalMinutes;
  discipline: ChallengeDiscipline;
  difficulty: ChallengeDifficulty;
  focus_group: string;
  focus_key: string;
  objective: string;
}

export interface DayScheduleConfig {
  enabled: boolean;
  slots: ClubScheduleSlot[];
}

export type WeeklyScheduleConfig = Record<DayOfWeekKey, DayScheduleConfig>;

export function createDefaultDaySlots(prefix: string): ClubScheduleSlot[] {
  return [
    {
      id: `${prefix}-1`,
      from_hour: 10,
      to_hour: 11,
      interval_minutes: 60,
      discipline: "tactics",
      difficulty: "Novice",
      focus_group: "all",
      focus_key: "all",
      objective: "all",
    },
    {
      id: `${prefix}-2`,
      from_hour: 15,
      to_hour: 16,
      interval_minutes: 60,
      discipline: "practical_chess",
      difficulty: "Pro",
      focus_group: "all",
      focus_key: "all",
      objective: "all",
    },
    {
      id: `${prefix}-3`,
      from_hour: 20,
      to_hour: 21,
      interval_minutes: 60,
      discipline: "finishhim",
      difficulty: "Novice",
      focus_group: "all",
      focus_key: "all",
      objective: "all",
    },
  ];
}

export function createDefaultWeeklySchedule(): WeeklyScheduleConfig {
  const result = {} as WeeklyScheduleConfig;
  for (const day of ALL_DAYS_OF_WEEK) {
    result[day] = {
      enabled: true,
      slots: createDefaultDaySlots(day),
    };
  }
  return result;
}

function isValidDiscipline(val: unknown): val is ChallengeDiscipline {
  return (
    typeof val === "string" &&
    (ALL_CHALLENGE_DISCIPLINES as readonly string[]).includes(val)
  );
}

function isValidDifficulty(val: unknown): val is ChallengeDifficulty {
  return (
    typeof val === "string" &&
    (ALL_CHALLENGE_DIFFICULTIES as readonly string[]).includes(val)
  );
}

function isValidInterval(val: unknown): val is ScheduleIntervalMinutes {
  return (
    typeof val === "number" &&
    (ALL_SCHEDULE_INTERVALS as readonly number[]).includes(val)
  );
}

export function normalizeWeeklySchedule(raw: unknown): WeeklyScheduleConfig {
  const fallback = createDefaultWeeklySchedule();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const record = raw as Record<string, unknown>;
  const result = {} as WeeklyScheduleConfig;

  for (const day of ALL_DAYS_OF_WEEK) {
    const dayRaw = record[day];
    if (!dayRaw || typeof dayRaw !== "object" || Array.isArray(dayRaw)) {
      result[day] = fallback[day];
      continue;
    }
    const dayObj = dayRaw as Record<string, unknown>;
    const enabled =
      typeof dayObj.enabled === "boolean" ? dayObj.enabled : true;
    const rawSlots = Array.isArray(dayObj.slots) ? dayObj.slots : [];

    const parsedSlots: ClubScheduleSlot[] = [];
    for (let i = 0; i < rawSlots.length; i += 1) {
      const item: unknown = rawSlots[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const slotObj = item as Record<string, unknown>;

      const rawFrom =
        typeof slotObj.from_hour === "number"
          ? Math.trunc(slotObj.from_hour)
          : 10;
      const fromHour = Math.min(21, Math.max(8, rawFrom));

      const rawTo =
        typeof slotObj.to_hour === "number"
          ? Math.trunc(slotObj.to_hour)
          : fromHour + 1;
      const toHour = Math.min(22, Math.max(fromHour + 1, rawTo));

      const intervalMinutes: ScheduleIntervalMinutes = isValidInterval(
        slotObj.interval_minutes
      )
        ? slotObj.interval_minutes
        : 60;

      const discipline: ChallengeDiscipline = isValidDiscipline(
        slotObj.discipline
      )
        ? slotObj.discipline
        : "tactics";

      const difficulty: ChallengeDifficulty = isValidDifficulty(
        slotObj.difficulty
      )
        ? slotObj.difficulty
        : "Novice";

      const focusGroup =
        typeof slotObj.focus_group === "string" && slotObj.focus_group.trim()
          ? slotObj.focus_group.trim()
          : "all";
      const focusKey =
        typeof slotObj.focus_key === "string" && slotObj.focus_key.trim()
          ? slotObj.focus_key.trim()
          : "all";
      const objective =
        typeof slotObj.objective === "string" && slotObj.objective.trim()
          ? slotObj.objective.trim()
          : "all";

      const id =
        typeof slotObj.id === "string" && slotObj.id.trim()
          ? slotObj.id.trim()
          : `${day}-${i + 1}`;

      parsedSlots.push({
        id,
        from_hour: fromHour,
        to_hour: toHour,
        interval_minutes: intervalMinutes,
        discipline,
        difficulty,
        focus_group: focusGroup,
        focus_key: focusKey,
        objective,
      });
    }

    parsedSlots.sort((a, b) => a.from_hour - b.from_hour);
    result[day] = {
      enabled,
      slots: parsedSlots,
    };
  }

  return result;
}

// ============================================================================
// Puzzle Service Raw Catalog Payloads
// ============================================================================

export interface TacticalPuzzlePayload {
  puzzle_id: string;
  discipline: ChallengeDiscipline;
  strategy: PuzzleStrategyType;
  first_move: "bot" | "user";
  user_color: "white" | "black";
  difficulty: ChallengeDifficulty;
  phase: string;
  length: string;
  goal: string;
  master_game: boolean;
  course_eligible: boolean;
  cognitive_profile: string;
  geometry_motifs: string[];
  operator_motifs: string[];
  concept_motifs: string[];
  trigger_motifs: string[];
  meta_themes: string[];
  tactical_fen: string;
  tactical_solution: string;
  rating: number;
  popularity: number;
  nb_plays: number;
  puzzle_fen: string;
}

export interface EndgamePuzzlePayload {
  puzzle_id: string;
  discipline: ChallengeDiscipline;
  ending_fen: string;
  puzzle_fen: string;
  difficulty: ChallengeDifficulty;
  ending_rating: number;
  effective_rating: number;
  pieces_count: number;
  domain: string;
  class: string;
  strategy: PuzzleStrategyType;
  first_move: "bot" | "user";
  user_color: "white" | "black";
  objective: PuzzleObjective;
  tactical_fen?: string;
  tactical_solution?: string;
  tactical_rating?: number;
  meta_themes?: string[];
  dtm?: number;
  dtz?: number;
}

// ============================================================================
// Mini App API DTOs
// ============================================================================

export interface TeleUserDTO {
  telegram_id: string;
  username: string | null;
  first_name: string;
  last_name: string | null;
  avatar_url: string | null;
  language_code: AppLanguage;
  is_superadmin: boolean;
  created_at: string;
}

export interface DisciplineAttemptStatsDTO {
  discipline: ChallengeDiscipline;
  total_attempts: number;
  solved_count: number;
  failed_count: number;
  total_points: number;
  total_time_ms: number;
}

export interface ClubSummaryDTO {
  chat_id: string;
  title: string;
  username: string | null;
  invite_link: string | null;
  owner_telegram_id: string;
  topic_thread_id: number;
  member_count: number;
  language: AppLanguage;
  timezone: string;
  status: ClubStatus;
  is_active: boolean;
  auto_paused: boolean;
  blocked_reason: string | null;
  is_default: boolean;
  is_admin: boolean;
  weekly_schedule: WeeklyScheduleConfig;
  schedule_times: string[];
  leaderboard_cron_days: number;
  filter_disciplines: ChallengeDiscipline[];
  filter_difficulties: ChallengeDifficulty[];
  filter_focus_group: string;
  filter_focus_keys: string[];
  filter_objective: string;
  last_published_at: string | null;
  published_challenges_count: number;
}

export interface UserChallengeHistoryItemDTO extends ClubChallengeItemDTO {
  chat_id: string;
  club_title: string;
  completed_at: string;
}

export interface UserCabinetDTO {
  user: TeleUserDTO;
  stats: Record<ChallengeDiscipline, DisciplineAttemptStatsDTO>;
  history: UserChallengeHistoryItemDTO[];
  clubs: ClubSummaryDTO[];
  my_clubs: ClubSummaryDTO[];
  owned_clubs_count: number;
  max_owned_clubs: number;
  default_chat_id: string;
  bot_username: string;
}

export interface ChallengeParticipantDTO {
  rank: number;
  telegram_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  status: ChallengeAttemptStatus;
  solved: boolean;
  attempts: number;
  points: number;
  score_text: string;
  solved_time_ms: number | null;
  uci_moves: string;
  pgn_moves: string;
  updated_at: string;
  completed_at: string | null;
}

export interface NextActiveChallengeRefDTO {
  discipline: ChallengeDiscipline;
  puzzle_id: string;
  edition: string;
  chat_id: string;
}

export interface ChallengeStateDTO {
  chat_id: string;
  club_title: string;
  discipline: ChallengeDiscipline;
  puzzle_id: string;
  edition: string;
  difficulty: ChallengeDifficulty;
  bot_engine: BotEngineId;
  initial_fen: string;
  puzzle_fen: string;
  user_color: "white" | "black";
  first_move: "bot" | "user";
  strategy: PuzzleStrategyType;
  objective: PuzzleObjective;
  tactical_solution: string;
  domain: string;
  category: string;
  tactical?: TacticalPuzzlePayload;
  endgame?: EndgamePuzzlePayload;
  my_entry: ChallengeParticipantDTO | null;
  leaderboard: ChallengeParticipantDTO[];
  remaining_active_count: number;
  next_active_challenge: NextActiveChallengeRefDTO | null;
}

export interface SubmitChallengeAttemptRequest {
  solved: boolean;
  time_ms: number;
  uci_moves?: string;
  pgn_moves?: string;
}

export interface ClubRecordEntryDTO {
  rank: number;
  telegram_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  total_points: number;
  tactics_points: number;
  finishhim_points: number;
  practical_points: number;
  theoretical_points: number;
  total_time_ms: number;
  total_seconds: number;
  solved_count: number;
  attempted_puzzles: number;
  total_attempts: number;
}

export interface ClubChallengeItemDTO {
  discipline: ChallengeDiscipline;
  puzzle_id: string;
  edition: string;
  difficulty: ChallengeDifficulty;
  category: string;
  domain: string;
  published_at: string;
  solved_count: number;
  best_time_ms: number | null;
  my_status: ChallengeAttemptStatus | null;
  my_solved: boolean;
  my_points: number;
  my_attempts: number;
}

export interface ClubRecordsResponseDTO {
  club: ClubSummaryDTO;
  records: ClubRecordEntryDTO[];
  recent_challenges: ClubChallengeItemDTO[];
}

export interface GoActiveChallengeItemDTO extends ClubChallengeItemDTO {
  chat_id: string;
  club_title: string;
}

export interface GoActiveChallengesResponseDTO {
  challenges: GoActiveChallengeItemDTO[];
}

export interface UpdateClubSettingsRequest {
  is_active: boolean;
  language: AppLanguage;
  timezone: string;
  status?: "active" | "paused";
  weekly_schedule: WeeklyScheduleConfig;
  leaderboard_cron_days: number;
  schedule_times?: string[];
  filter_disciplines?: ChallengeDiscipline[];
  filter_difficulties?: ChallengeDifficulty[];
  filter_focus_group?: string;
  filter_focus_keys?: string[];
  filter_objective?: string;
}

export interface SuperAdminOverviewDTO {
  total_users: number;
  total_clubs: number;
  total_attempts: number;
  total_solved: number;
  clubs: ClubSummaryDTO[];
  promos: PromoCampaignDTO[];
}

export interface PromoCampaignDTO {
  id: number;
  title: string;
  text_ru: string;
  text_en: string;
  button_ru: string | null;
  button_en: string | null;
  target_url: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ClubCompetitionRowDTO {
  rank: number;
  chat_id: string;
  title: string;
  username: string | null;
  is_default: boolean;
  is_member: boolean;
  is_admin: boolean;
  is_active: boolean;
  auto_paused: boolean;
  member_count: number;
  active_players_30d: number;
  solved_count_30d: number;
  tactics_points: number;
  theoretical_points: number;
  practical_points: number;
  finishhim_points: number;
  total_points: number;
  average_points: number;
}

export interface ClubsCompetitionResponseDTO {
  period_days: number;
  clubs: ClubCompetitionRowDTO[];
}

export function roundPoints(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Points formula per solved puzzle: `1 / attempts` (e.g. 1st try = 1, 2nd = 0.5, 3rd = 0.33, 4th = 0.25).
 * Unsolved / in-progress / surrendered attempts earn 0 points.
 */
export function calculateAttemptPoints(solved: boolean, attempts: number): number {
  if (!solved) return 0;
  const safeAttempts = Math.max(1, attempts);
  return 1 / safeAttempts;
}

// ============================================================================
// Deep-Link Encoding / Decoding (`tgWebAppStartParam`)
// ============================================================================

/**
 * Encodes a challenge or records route into a compact Telegram `startapp` parameter
 * (allowed characters in Telegram `startapp`: A-Z, a-z, 0-9, `_`, `-`, max 64 chars).
 *
 * Format:
 * - Challenge: `c_<discCode>_<puzzleId>_<edition>_<chatIdEncoded>`
 * - Task Records: `r_<discCode>_<puzzleId>_<edition>_<chatIdEncoded>`
 * - Club Records: `l_<chatIdEncoded>`
 */
const DISC_TO_CODE: Record<ChallengeDiscipline, string> = {
  tactics: "t",
  theoretical_endgames: "e",
  practical_chess: "p",
  finishhim: "f",
};

const CODE_TO_DISC: Record<string, ChallengeDiscipline> = {
  t: "tactics",
  e: "theoretical_endgames",
  p: "practical_chess",
  f: "finishhim",
};

export function encodeChatIdForStartParam(chatId: string): string {
  const trimmed = chatId.trim();
  if (trimmed.startsWith("-")) {
    return `n${trimmed.slice(1)}`;
  }
  return trimmed;
}

export function decodeChatIdFromStartParam(encoded: string): string {
  const trimmed = encoded.trim();
  if (trimmed.startsWith("n")) {
    return `-${trimmed.slice(1)}`;
  }
  return trimmed;
}

export function encodeChallengeStartParam(
  discipline: ChallengeDiscipline,
  puzzleId: string,
  edition: string,
  chatId: string
): string {
  const code = DISC_TO_CODE[discipline];
  const safeEdition = edition.trim() || "0";
  return `c__${code}__${puzzleId}__${safeEdition}__${encodeChatIdForStartParam(chatId)}`;
}

export function encodeChallengeRecordsStartParam(
  discipline: ChallengeDiscipline,
  puzzleId: string,
  edition: string,
  chatId: string
): string {
  const code = DISC_TO_CODE[discipline];
  const safeEdition = edition.trim() || "0";
  return `r__${code}__${puzzleId}__${safeEdition}__${encodeChatIdForStartParam(chatId)}`;
}

export function encodeClubLeaderboardStartParam(chatId: string): string {
  return `l__${encodeChatIdForStartParam(chatId)}`;
}

export function resolveRouteFromStartParam(startParam: string): string | null {
  const raw = startParam.trim();
  if (!raw) return null;

  const parts = raw.split("__");
  const kind = parts[0];

  if (kind === "l" && parts.length >= 2 && parts[1]) {
    const chatId = decodeChatIdFromStartParam(parts[1]);
    return `/challenge/records/${encodeURIComponent(chatId)}`;
  }

  if ((kind === "c" || kind === "r") && parts.length >= 5) {
    const disc = CODE_TO_DISC[parts[1] ?? ""];
    const puzzleId = parts[2];
    const edition = parts[3];
    const chatId = parts[4] ? decodeChatIdFromStartParam(parts[4]) : "";
    if (!disc || !puzzleId || !edition || !chatId) return null;

    const prefix = kind === "c" ? "/challenge" : "/records";
    return `${prefix}/${disc}/${encodeURIComponent(puzzleId)}/${encodeURIComponent(edition)}/${encodeURIComponent(chatId)}`;
  }

  return null;
}

