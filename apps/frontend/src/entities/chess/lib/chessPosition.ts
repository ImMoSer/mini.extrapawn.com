import type { Dests, Key } from "@lichess-org/chessground/types";
import { Chess } from "chessops/chess";
import { chessgroundDests } from "chessops/compat";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeSquare, parseSquare, parseUci } from "chessops/util";

export interface PositionSnapshot {
  fen: string;
  turnColor: "white" | "black";
  dests: Dests;
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isInsufficientMaterial: boolean;
  isEnd: boolean;
  piecesCount: number;
}

export interface AppliedMoveResult {
  nextFen: string;
  uci: string;
  san: string;
  from: Key;
  to: Key;
  isCapture: boolean;
  isCastle: boolean;
  isPromotion: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isInsufficientMaterial: boolean;
  isFiftyMoves: boolean;
  isDraw: boolean;
}

/**
 * Extracts the first 4 FEN fields (piece placement, active color, castling, en passant)
 * per FIDE Article 9.2 for threefold repetition comparison.
 */
export function normalizeFenForRepetition(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

/**
 * Returns true when `currentFen` appears at least 3 times in `fenHistory`
 * (including the starting position and the latest position).
 */
export function isThreefoldRepetition(
  fenHistory: readonly string[],
  currentFen: string
): boolean {
  const target = normalizeFenForRepetition(currentFen);
  let occurrences = 0;
  for (const historicFen of fenHistory) {
    if (normalizeFenForRepetition(historicFen) === target) {
      occurrences += 1;
      if (occurrences >= 3) {
        return true;
      }
    }
  }
  return false;
}

export interface ReplayStepSnapshot {
  stepIndex: number;
  fen: string;
  uci: string;
  san: string;
  lastMove?: [Key, Key];
}

function createChessFromFen(fen: string): Chess {
  const setup = parseFen(fen);
  if (setup.isErr) {
    throw new Error(`Invalid FEN '${fen}': ${setup.error.message}`);
  }
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) {
    throw new Error(`Invalid Chess position '${fen}': ${pos.error.message}`);
  }
  return pos.value;
}

export function analyzeFenPosition(fen: string): PositionSnapshot {
  const pos = createChessFromFen(fen);
  const dests = chessgroundDests(pos) as Dests;
  const piecesCount = pos.board.occupied.size();

  return {
    fen,
    turnColor: pos.turn,
    dests,
    isCheck: pos.isCheck(),
    isCheckmate: pos.isCheckmate(),
    isStalemate: pos.isStalemate(),
    isInsufficientMaterial: pos.isInsufficientMaterial(),
    isEnd: pos.isEnd(),
    piecesCount,
  };
}

export function requiresPawnPromotion(
  fen: string,
  orig: Key,
  dest: Key
): boolean {
  const pos = createChessFromFen(fen);
  const fromSq = parseSquare(orig);
  const toSq = parseSquare(dest);
  if (fromSq === undefined || toSq === undefined) return false;

  const piece = pos.board.get(fromSq);
  if (!piece || piece.role !== "pawn") return false;

  const rank = Math.floor(toSq / 8);
  return (
    (piece.color === "white" && rank === 7) ||
    (piece.color === "black" && rank === 0)
  );
}

export function applyMoveToFen(
  fen: string,
  uciMove: string
): AppliedMoveResult {
  const pos = createChessFromFen(fen);
  const parsed = parseUci(uciMove.trim());
  if (!parsed || !("from" in parsed) || !pos.isLegal(parsed)) {
    throw new Error(`Illegal UCI move '${uciMove}' on FEN '${fen}'`);
  }

  const san = makeSan(pos, parsed);
  const targetPiece = pos.board.get(parsed.to);
  const movingPiece = pos.board.get(parsed.from);
  const isEnPassant =
    movingPiece?.role === "pawn" &&
    parsed.from % 8 !== parsed.to % 8 &&
    !targetPiece;
  const isCapture = Boolean(targetPiece) || isEnPassant;
  const isCastle = san.startsWith("O-O");
  const isPromotion = Boolean(parsed.promotion);

  pos.play(parsed);
  const nextFen = makeFen(pos.toSetup());
  const isCheck = pos.isCheck();
  const isCheckmate = pos.isCheckmate();
  const isStalemate = pos.isStalemate();
  const isInsufficientMaterial = pos.isInsufficientMaterial();
  const isFiftyMoves = pos.halfmoves >= 100;
  const isDraw = isStalemate || isInsufficientMaterial || isFiftyMoves;

  return {
    nextFen,
    uci: uciMove.trim(),
    san,
    from: makeSquare(parsed.from),
    to: makeSquare(parsed.to),
    isCapture,
    isCastle,
    isPromotion,
    isCheck,
    isCheckmate,
    isStalemate,
    isInsufficientMaterial,
    isFiftyMoves,
    isDraw,
  };
}

export function buildReplayTimeline(
  startFen: string,
  uciMovesString: string
): ReplayStepSnapshot[] {
  const timeline: ReplayStepSnapshot[] = [
    {
      stepIndex: 0,
      fen: startFen,
      uci: "",
      san: "",
    },
  ];

  const moves = uciMovesString.trim().split(/\s+/).filter(Boolean);
  let currentFen = startFen;

  for (let i = 0; i < moves.length; i++) {
    const uci = moves[i];
    if (!uci) break;
    try {
      const applied = applyMoveToFen(currentFen, uci);
      currentFen = applied.nextFen;
      timeline.push({
        stepIndex: i + 1,
        fen: currentFen,
        uci: applied.uci,
        san: applied.san,
        lastMove: [applied.from, applied.to],
      });
    } catch {
      break;
    }
  }

  return timeline;
}

export function uciLineToSan(startFen: string, uciMoves: string[]): string[] {
  let pos: Chess;
  try {
    pos = createChessFromFen(startFen);
  } catch {
    return uciMoves;
  }

  const sanList: string[] = [];
  for (const uci of uciMoves) {
    const parsed = parseUci(uci.trim());
    if (!parsed || !("from" in parsed) || !pos.isLegal(parsed)) {
      break;
    }
    sanList.push(makeSan(pos, parsed));
    pos.play(parsed);
  }
  return sanList;
}


