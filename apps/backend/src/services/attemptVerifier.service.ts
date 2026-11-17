import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
import type {
  ChallengeDiscipline,
  PuzzleObjective,
  PuzzleStrategyType,
} from "shared";

const MIN_MOVE_TIME_MS = 50;
const MAX_MOVE_TIME_MS = 10_000;
const MAX_SPARRING_PLIES = 400;

export interface VerifiedSolvedAttemptMoves {
  uciMoves: string;
  pgnMoves: string;
  moveTimesMs: number[] | null;
  userMovesCount: number;
  hasMoveTimings: boolean;
}

export class InvalidAttemptSolutionError extends Error {
  public readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "InvalidAttemptSolutionError";
  }
}

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

function sanitizeTimings(
  plyCount: number,
  rawMoveTimesMs?: number[]
): number[] | null {
  if (
    plyCount <= 0 ||
    !Array.isArray(rawMoveTimesMs) ||
    rawMoveTimesMs.length !== plyCount
  ) {
    return null;
  }
  return rawMoveTimesMs.map((raw) => {
    const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 250;
    return Math.min(MAX_MOVE_TIME_MS, Math.max(MIN_MOVE_TIME_MS, Math.round(n)));
  });
}

/**
 * Verifies a solved challenge submission purely in-memory via `chessops` (~0.2 ms, 0 engine calls):
 * 1. Ensures every submitted UCI move is strictly legal from `puzzleFen`.
 * 2. For `tactics` (`scenarioOnly`): verifies the move sequence matches `tacticalSolution` (or delivers legal checkmate),
 *    returning empty strings for DB persistence to preserve anti-spoiler rules.
 * 3. For `playOutOnly` / `scenarioPlus`: verifies the final board state meets `objective` (`win` -> checkmate by user;
 *    `hold_draw` -> FIDE draw or checkmate by user) and computes clean server-generated SAN (`pgnMoves`).
 */
export function verifyAndSanitizeSolvedAttempt(params: {
  discipline: ChallengeDiscipline;
  strategy: PuzzleStrategyType;
  objective: PuzzleObjective;
  userColor: "white" | "black";
  firstMove: "bot" | "user";
  puzzleFen: string;
  tacticalSolution: string;
  rawUciMoves?: string;
  rawMoveTimesMs?: number[];
}): VerifiedSolvedAttemptMoves {
  const uciList = (params.rawUciMoves ?? "")
    .trim()
    .split(/\s+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (uciList.length === 0 || uciList.length > MAX_SPARRING_PLIES) {
    throw new InvalidAttemptSolutionError(
      "Solved attempt requires a valid non-empty UCI move sequence."
    );
  }

  const pos = createPositionFromFen(params.puzzleFen);
  const expectedScenario = extractExpectedScenarioMoves(
    params.firstMove,
    params.tacticalSolution
  );

  if (params.discipline === "tactics" || params.strategy === "scenarioOnly") {
    if (expectedScenario.length === 0) {
      throw new InvalidAttemptSolutionError(
        "Tactical challenge is missing expected solution moves."
      );
    }

    let scenarioSolved = false;
    for (let i = 0; i < uciList.length; i += 1) {
      const uci = uciList[i] ?? "";
      const parsed = parseUci(uci);
      if (!parsed || !("from" in parsed) || !pos.isLegal(parsed)) {
        throw new InvalidAttemptSolutionError(
          `Illegal tactical move '${uci}' at ply ${i + 1}.`
        );
      }

      const isUserTurn = i % 2 === 0;
      const expectedUci = expectedScenario[i];
      pos.play(parsed);

      if (isUserTurn && pos.isCheckmate()) {
        scenarioSolved = true;
        break;
      }

      if (!expectedUci || !matchesExpectedScenarioUci(uci, expectedUci)) {
        throw new InvalidAttemptSolutionError(
          `Move '${uci}' at ply ${i + 1} does not match tactical solution.`
        );
      }

      if (i + 1 >= expectedScenario.length) {
        scenarioSolved = true;
        break;
      }
    }

    if (!scenarioSolved) {
      throw new InvalidAttemptSolutionError(
        "Tactical solution sequence is incomplete."
      );
    }

    return {
      uciMoves: "",
      pgnMoves: "",
      moveTimesMs: null,
      userMovesCount: 0,
      hasMoveTimings: false,
    };
  }

  const normalizedUci: string[] = [];
  const sanList: string[] = [];
  const fenHistory: string[] = [makeFen(pos.toSetup())];
  let earlyScenarioMate = false;

  for (let i = 0; i < uciList.length; i += 1) {
    const uci = uciList[i] ?? "";
    const parsed = parseUci(uci);
    if (!parsed || !("from" in parsed) || !pos.isLegal(parsed)) {
      throw new InvalidAttemptSolutionError(
        `Illegal move '${uci}' at ply ${i + 1}.`
      );
    }

    const san = makeSan(pos, parsed);
    pos.play(parsed);
    const nextFen = makeFen(pos.toSetup());

    normalizedUci.push(uci);
    sanList.push(san);
    fenHistory.push(nextFen);

    if (
      params.strategy === "scenarioPlus" &&
      i < expectedScenario.length &&
      !earlyScenarioMate
    ) {
      const isUserTurn = i % 2 === 0;
      if (isUserTurn && pos.isCheckmate()) {
        earlyScenarioMate = true;
      } else {
        const expectedUci = expectedScenario[i];
        if (expectedUci && !matchesExpectedScenarioUci(uci, expectedUci)) {
          throw new InvalidAttemptSolutionError(
            `Scenario prefix move '${uci}' at ply ${i + 1} does not match.`
          );
        }
      }
    }
  }

  const lastFen = fenHistory[fenHistory.length - 1] ?? params.puzzleFen;
  const isUserCheckmate = pos.isCheckmate() && pos.turn !== params.userColor;
  const isFideDraw =
    pos.isStalemate() ||
    pos.isInsufficientMaterial() ||
    pos.halfmoves >= 100 ||
    hasThreefoldRepetition(fenHistory, lastFen);

  const goalAchieved =
    params.objective === "hold_draw"
      ? isFideDraw || isUserCheckmate
      : isUserCheckmate;

  if (!goalAchieved) {
    throw new InvalidAttemptSolutionError(
      `Final board position does not satisfy challenge objective '${params.objective}'.`
    );
  }

  const moveTimesMs = sanitizeTimings(
    normalizedUci.length,
    params.rawMoveTimesMs
  );

  return {
    uciMoves: normalizedUci.join(" "),
    pgnMoves: sanList.join(" "),
    moveTimesMs,
    userMovesCount: Math.ceil(normalizedUci.length / 2),
    hasMoveTimings: moveTimesMs !== null,
  };
}
