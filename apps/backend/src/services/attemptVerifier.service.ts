import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import type {
  ChallengeDiscipline,
  ChallengeMoveOutcome,
  PuzzleObjective,
  PuzzleStrategyType,
} from "shared";

export const MIN_MOVE_TIME_MS = 50;
export const MAX_MOVE_TIME_MS = 10_000;
export const BOT_NORMALIZED_MOVE_TIME_MS = 250;
export const MAX_SPARRING_PLIES = 400;
export const MAX_ATTEMPT_ELAPSED_MS = 3_600_000; // 60 min cap matching puzzle_service

export class InvalidAttemptSolutionError extends Error {
  public readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "InvalidAttemptSolutionError";
  }
}

export interface SolvedMovesPayload {
  uciMoves: string;
  pgnMoves: string;
  moveTimesMs: number[] | null;
  userMovesCount: number;
  hasMoveTimings: boolean;
}

export interface EvaluatedStepTerminalOrContinue {
  kind: "resolved";
  outcome: ChallengeMoveOutcome;
  botMoveUci: string | null;
  nextDraftUciMoves: string;
  nextDraftMoveTimesMs: number[] | null;
  solvedPayload: SolvedMovesPayload | null;
}

export interface PendingSparringReplyContext {
  kind: "needs_sparring_reply";
  pos: Chess;
  discipline: ChallengeDiscipline;
  objective: PuzzleObjective;
  uciList: string[];
  sanList: string[];
  fenHistory: string[];
  timesList: number[];
}

export type InitialMoveEvaluation =
  | EvaluatedStepTerminalOrContinue
  | PendingSparringReplyContext;

function normalizeFenFourFields(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

function hasThreefoldRepetition(
  fenHistory: readonly string[],
  targetFen: string
): boolean {
  const target = normalizeFenFourFields(targetFen);
  let count = 0;
  for (const item of fenHistory) {
    if (normalizeFenFourFields(item) === target) {
      count += 1;
      if (count >= 3) {
        return true;
      }
    }
  }
  return false;
}

function isFideDrawPosition(pos: Chess, fenHistory: readonly string[]): boolean {
  const latestFen = fenHistory[fenHistory.length - 1] ?? "";
  return (
    pos.isStalemate() ||
    pos.isInsufficientMaterial() ||
    pos.halfmoves >= 100 ||
    hasThreefoldRepetition(fenHistory, latestFen)
  );
}

function createPositionFromFen(fen: string): Chess {
  const setup = parseFen(fen);
  if (setup.isErr) {
    throw new InvalidAttemptSolutionError(
      `Invalid challenge puzzle FEN: ${setup.error.message}`
    );
  }
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) {
    throw new InvalidAttemptSolutionError(
      `Illegal challenge puzzle setup: ${pos.error.message}`
    );
  }
  return pos.value;
}

function matchesExpectedScenarioUci(
  playedUci: string,
  expectedUci: string
): boolean {
  const a = playedUci.toLowerCase();
  const b = expectedUci.toLowerCase();
  if (a === b) return true;
  return a.slice(0, 4) === b.slice(0, 4) && a.length === 5 && b.length === 4;
}

function extractExpectedScenarioMoves(
  firstMove: string,
  tacticalSolution: string
): string[] {
  const tokens = tacticalSolution
    .trim()
    .split(/\s+/)
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
  if (firstMove === "bot" && tokens.length > 0) {
    return tokens.slice(1);
  }
  return tokens;
}

export function clampPlyMoveTimeMs(rawMoveTimeMs?: number): number {
  const n =
    typeof rawMoveTimeMs === "number" && Number.isFinite(rawMoveTimeMs)
      ? rawMoveTimeMs
      : BOT_NORMALIZED_MOVE_TIME_MS;
  return Math.min(MAX_MOVE_TIME_MS, Math.max(MIN_MOVE_TIME_MS, Math.round(n)));
}

function buildSolvedPayload(
  discipline: ChallengeDiscipline,
  uciList: readonly string[],
  sanList: readonly string[],
  timesList: readonly number[]
): SolvedMovesPayload {
  if (discipline === "tactics") {
    return {
      uciMoves: "",
      pgnMoves: "",
      moveTimesMs: null,
      userMovesCount: 0,
      hasMoveTimings: false,
    };
  }
  const validTimings =
    timesList.length === uciList.length && uciList.length > 0
      ? [...timesList]
      : null;

  return {
    uciMoves: uciList.join(" "),
    pgnMoves: sanList.join(" "),
    moveTimesMs: validTimings,
    userMovesCount: Math.ceil(uciList.length / 2),
    hasMoveTimings: validTimings !== null,
  };
}

/**
 * Pure server-side `chessops` step evaluator (~0.1 ms, 0 network calls):
 * Replays existing persisted attempt moves from `puzzleFen`, validates the incoming `userUciMove`,
 * checks hidden `tacticalSolution` when in scenario phase, and either resolves immediately
 * (`wrong_move`, `solved`, `failed_attempt`, `continue` with scripted reply) or requests a sparring bot reply.
 */
export function evaluateUserChallengeMove(params: {
  discipline: ChallengeDiscipline;
  strategy: PuzzleStrategyType;
  objective: PuzzleObjective;
  userColor: "white" | "black";
  firstMove: "bot" | "user";
  puzzleFen: string;
  tacticalSolution: string;
  prevUciMoves: string;
  prevMoveTimesMs: readonly number[] | null;
  userUciMove: string;
  rawUserMoveTimeMs?: number;
}): InitialMoveEvaluation {
  const pos = createPositionFromFen(params.puzzleFen);
  const prevTokens = params.prevUciMoves
    .trim()
    .split(/\s+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (prevTokens.length >= MAX_SPARRING_PLIES) {
    throw new InvalidAttemptSolutionError(
      "Maximum sparring ply limit reached for this attempt."
    );
  }

  const uciList: string[] = [];
  const sanList: string[] = [];
  const fenHistory: string[] = [makeFen(pos.toSetup())];
  const timesList: number[] = [];

  for (let i = 0; i < prevTokens.length; i += 1) {
    const prevUci = prevTokens[i] ?? "";
    const parsedPrev = parseUci(prevUci);
    if (!parsedPrev || !("from" in parsedPrev) || !pos.isLegal(parsedPrev)) {
      throw new InvalidAttemptSolutionError(
        `Corrupt persisted move '${prevUci}' at ply ${i + 1}.`
      );
    }
    const san = makeSan(pos, parsedPrev);
    pos.play(parsedPrev);
    uciList.push(prevUci);
    sanList.push(san);
    fenHistory.push(makeFen(pos.toSetup()));
    timesList.push(clampPlyMoveTimeMs(params.prevMoveTimesMs?.[i]));
  }

  if (pos.turn !== params.userColor) {
    throw new InvalidAttemptSolutionError(
      "Active attempt position is not on the player's turn."
    );
  }

  const userUci = params.userUciMove.trim().toLowerCase();
  const parsedUser = parseUci(userUci);
  if (!parsedUser || !("from" in parsedUser) || !pos.isLegal(parsedUser)) {
    throw new InvalidAttemptSolutionError(
      `Illegal move '${userUci}' on current challenge board.`
    );
  }

  const expectedScenario = extractExpectedScenarioMoves(
    params.firstMove,
    params.tacticalSolution
  );
  const isScenarioOnly =
    params.discipline === "tactics" || params.strategy === "scenarioOnly";
  const inScenarioPhase =
    isScenarioOnly ||
    (params.strategy === "scenarioPlus" &&
      uciList.length < expectedScenario.length);

  if (isScenarioOnly && expectedScenario.length === 0) {
    throw new InvalidAttemptSolutionError(
      "Tactical challenge is missing expected solution moves."
    );
  }

  const expectedUserUci = expectedScenario[uciList.length];
  const userSan = makeSan(pos, parsedUser);
  pos.play(parsedUser);
  const afterUserFen = makeFen(pos.toSetup());

  if (inScenarioPhase) {
    const isScenarioMatch =
      pos.isCheckmate() ||
      (expectedUserUci !== undefined &&
        matchesExpectedScenarioUci(userUci, expectedUserUci));

    if (!isScenarioMatch) {
      return {
        kind: "resolved",
        outcome: "wrong_move",
        botMoveUci: null,
        nextDraftUciMoves: "",
        nextDraftMoveTimesMs: null,
        solvedPayload: null,
      };
    }
  }

  uciList.push(userUci);
  sanList.push(userSan);
  fenHistory.push(afterUserFen);
  timesList.push(clampPlyMoveTimeMs(params.rawUserMoveTimeMs));

  if (pos.isCheckmate()) {
    return {
      kind: "resolved",
      outcome: "solved",
      botMoveUci: null,
      nextDraftUciMoves: "",
      nextDraftMoveTimesMs: null,
      solvedPayload: buildSolvedPayload(
        params.discipline,
        uciList,
        sanList,
        timesList
      ),
    };
  }

  if (isFideDrawPosition(pos, fenHistory)) {
    if (params.objective === "hold_draw") {
      return {
        kind: "resolved",
        outcome: "solved",
        botMoveUci: null,
        nextDraftUciMoves: "",
        nextDraftMoveTimesMs: null,
        solvedPayload: buildSolvedPayload(
          params.discipline,
          uciList,
          sanList,
          timesList
        ),
      };
    }
    return {
      kind: "resolved",
      outcome: "failed_attempt",
      botMoveUci: null,
      nextDraftUciMoves: "",
      nextDraftMoveTimesMs: null,
      solvedPayload: null,
    };
  }

  if (isScenarioOnly && uciList.length >= expectedScenario.length) {
    return {
      kind: "resolved",
      outcome: "solved",
      botMoveUci: null,
      nextDraftUciMoves: "",
      nextDraftMoveTimesMs: null,
      solvedPayload: buildSolvedPayload(
        params.discipline,
        uciList,
        sanList,
        timesList
      ),
    };
  }

  const scriptedBotUci = inScenarioPhase
    ? expectedScenario[uciList.length]
    : undefined;

  if (scriptedBotUci) {
    const parsedBot = parseUci(scriptedBotUci);
    if (!parsedBot || !("from" in parsedBot) || !pos.isLegal(parsedBot)) {
      throw new InvalidAttemptSolutionError(
        `Illegal scripted reply '${scriptedBotUci}' in puzzle snapshot.`
      );
    }
    const botSan = makeSan(pos, parsedBot);
    pos.play(parsedBot);
    uciList.push(scriptedBotUci);
    sanList.push(botSan);
    fenHistory.push(makeFen(pos.toSetup()));
    timesList.push(BOT_NORMALIZED_MOVE_TIME_MS);

    if (pos.isCheckmate()) {
      return {
        kind: "resolved",
        outcome: "failed_attempt",
        botMoveUci: scriptedBotUci,
        nextDraftUciMoves: "",
        nextDraftMoveTimesMs: null,
        solvedPayload: null,
      };
    }

    if (isFideDrawPosition(pos, fenHistory)) {
      if (params.objective === "hold_draw") {
        return {
          kind: "resolved",
          outcome: "solved",
          botMoveUci: scriptedBotUci,
          nextDraftUciMoves: "",
          nextDraftMoveTimesMs: null,
          solvedPayload: buildSolvedPayload(
            params.discipline,
            uciList,
            sanList,
            timesList
          ),
        };
      }
      return {
        kind: "resolved",
        outcome: "failed_attempt",
        botMoveUci: scriptedBotUci,
        nextDraftUciMoves: "",
        nextDraftMoveTimesMs: null,
        solvedPayload: null,
      };
    }

    if (isScenarioOnly && uciList.length >= expectedScenario.length) {
      return {
        kind: "resolved",
        outcome: "solved",
        botMoveUci: scriptedBotUci,
        nextDraftUciMoves: "",
        nextDraftMoveTimesMs: null,
        solvedPayload: buildSolvedPayload(
          params.discipline,
          uciList,
          sanList,
          timesList
        ),
      };
    }

    return {
      kind: "resolved",
      outcome: "continue",
      botMoveUci: scriptedBotUci,
      nextDraftUciMoves: uciList.join(" "),
      nextDraftMoveTimesMs: timesList,
      solvedPayload: null,
    };
  }

  return {
    kind: "needs_sparring_reply",
    pos,
    discipline: params.discipline,
    objective: params.objective,
    uciList,
    sanList,
    fenHistory,
    timesList,
  };
}

export function applySparringBotReplyAndResolve(
  ctx: PendingSparringReplyContext,
  rawBotBestMove: string
): EvaluatedStepTerminalOrContinue {
  const botUci = rawBotBestMove.trim().toLowerCase();
  const parsedBot = parseUci(botUci);
  if (!parsedBot || !("from" in parsedBot) || !ctx.pos.isLegal(parsedBot)) {
    throw new Error(
      `[AttemptVerifier] Engine returned illegal move '${rawBotBestMove}'.`
    );
  }

  const botSan = makeSan(ctx.pos, parsedBot);
  ctx.pos.play(parsedBot);
  ctx.uciList.push(botUci);
  ctx.sanList.push(botSan);
  ctx.fenHistory.push(makeFen(ctx.pos.toSetup()));
  ctx.timesList.push(BOT_NORMALIZED_MOVE_TIME_MS);

  if (ctx.pos.isCheckmate()) {
    return {
      kind: "resolved",
      outcome: "failed_attempt",
      botMoveUci: botUci,
      nextDraftUciMoves: "",
      nextDraftMoveTimesMs: null,
      solvedPayload: null,
    };
  }

  const reachedPlyCap = ctx.uciList.length >= MAX_SPARRING_PLIES;
  if (isFideDrawPosition(ctx.pos, ctx.fenHistory) || reachedPlyCap) {
    if (ctx.objective === "hold_draw") {
      return {
        kind: "resolved",
        outcome: "solved",
        botMoveUci: botUci,
        nextDraftUciMoves: "",
        nextDraftMoveTimesMs: null,
        solvedPayload: buildSolvedPayload(
          ctx.discipline,
          ctx.uciList,
          ctx.sanList,
          ctx.timesList
        ),
      };
    }
    return {
      kind: "resolved",
      outcome: "failed_attempt",
      botMoveUci: botUci,
      nextDraftUciMoves: "",
      nextDraftMoveTimesMs: null,
      solvedPayload: null,
    };
  }

  return {
    kind: "resolved",
    outcome: "continue",
    botMoveUci: botUci,
    nextDraftUciMoves: ctx.uciList.join(" "),
    nextDraftMoveTimesMs: ctx.timesList,
    solvedPayload: null,
  };
}
