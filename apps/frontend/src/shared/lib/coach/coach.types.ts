export interface CoachTheme {
  id: string;
  side: string;
  strength: number;
  description: string;
}

export interface OpeningInfo {
  name: string;
  eco: string;
  wiki_path?: string | null;
  transposition?: boolean | null;
  played_path?: string | null;
  theoretical_fen?: string | null;
  theoretical_string?: string | null;
  wikibooks_url?: string | null;
}

export interface TheoreticalContinuation {
  san: string;
  name?: string | null;
  eco?: string | null;
  popularity?: number | null;
  total?: number | null;
}

export interface CoachVisualCommands {
  best_move?: string | string[];
  maneuver?: string | string[];
  pawn_race?: string | string[];
  key_squares?: string | string[];
  diagonals?: string | string[];
  structure_white?: string | string[];
  structure_black?: string | string[];
  [key: string]: unknown;
}

export interface CoachTopMove {
  rank: number;
  uci: string;
  move?: string;
  quality?: string;
  san: string;
  name?: string | null;
  eco?: string | null;
  ecoName?: string | null;
  win_p?: number | null;
  draw_p?: number | null;
  loss_p?: number | null;
  winP?: number | null;
  drawP?: number | null;
  lossP?: number | null;
  whiteP?: number | null;
  blackP?: number | null;
  popularity?: number | null;
  totalGames?: number | null;
  total?: number | null;
  score?: number;
  eval_cp?: number;
  eval_pawns?: number;
  mate?: number | null;
  isMate?: boolean;
  is_mate?: boolean;
  mateIn?: number | null;
  mate_in?: number | null;
  motifs?: string[];
  targetsKing?: boolean;
  targets_king?: boolean;
  headline?: string | null;
  tagline?: string | null;
  plan_theme?: string | null;
  plan_brief?: string | null;
  plan_pv?: string[];
  pv?: string[];
  theoreticalContinuations?: TheoreticalContinuation[];
  pvLine?: { san: string; tts?: string; tagline?: string }[];
  pv_line?: { san: string; tts?: string; tagline?: string }[];
  character?: string;
  character_reason?: string;
  explanation?: {
    quality: string;
    summary: string;
    details: string;
    best_move_san: string;
    is_best_move: boolean;
    winRateLoss?: number;
  };
  wdl?:
    | {
        white: number;
        draw: number;
        black: number;
        popularity?: number | null;
        total_games?: number | null;
      }
    | { win: number; draw: number; loss: number };
  visual_commands?: CoachVisualCommands | Record<string, unknown> | string | null;
}

export interface CoachPositionStatus {
  side_to_move: string;
  phase: string;
  material_delta: number;
}

export interface CoachLastMoveAnalysis {
  loading?: boolean;
  san: string;
  move_san?: string;
  move_uci?: string;
  uci?: string;
  fen?: string;
  quality?: string;
  summary?: string;
  details?: string | string[];
  consequence?: string;
  motifs?: string[];
  bestMove?: string;
  bestMoveSan?: string;
  eval_cp?: number;
  winRateLoss?: number;
  is_best_move?: boolean;
  isBestMove?: boolean;
  wdl?: { win: number; draw: number; loss: number };
  [key: string]: unknown;
}

export interface CoachExplanation {
  fen: string;
  side_to_move: "white" | "black";
  position_status?: CoachPositionStatus;
  last_move_analysis?: CoachLastMoveAnalysis | null;
  eval_cp?: number;
  eval_pawns: number;
  verdict?: string;
  eval_mate?: number | null;
  phase: "opening" | "middlegame" | "endgame";
  move_number: number;
  themes?: CoachTheme[];
  strategic_themes?: CoachTheme[];
  opening_info?: OpeningInfo | null;
  principal_plan?: {
    eval_cp: number;
    eval_mate: number | null;
    depth: number;
    moves: {
      san: string;
      uci: string;
      quality?: string;
      role?: string;
      motifs?: string[];
      headline?: string;
      to?: string;
      from?: string;
    }[];
    key_squares: string[];
    theme: string | null;
    description: string;
  };
  engine_top_moves?: CoachTopMove[];
  engine_candidates?: CoachTopMove[];
  visual_commands?: CoachVisualCommands;
  summary_text?: string;
  action?: string;
  opening_name?: string;
  opening_eco?: string;
  game_phase?: string;
  material_imbalance?: number;
  strategic_summary?: string;
  key_imbalance?: string;
  engine_best_move?: string;
}

