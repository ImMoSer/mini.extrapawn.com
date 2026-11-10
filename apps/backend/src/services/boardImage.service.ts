import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Resvg } from "@resvg/resvg-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type PieceKey =
  | "wP"
  | "wN"
  | "wB"
  | "wR"
  | "wQ"
  | "wK"
  | "bP"
  | "bN"
  | "bB"
  | "bR"
  | "bQ"
  | "bK";

const FEN_CHAR_TO_PIECE_KEY: Record<string, PieceKey> = {
  P: "wP",
  N: "wN",
  B: "wB",
  R: "wR",
  Q: "wQ",
  K: "wK",
  p: "bP",
  n: "bN",
  b: "bB",
  r: "bR",
  q: "bQ",
  k: "bK",
};

const pieceInnerSvgCache = new Map<PieceKey, string>();

function resolvePiecesDir(): string {
  const candidates = [
    path.resolve(__dirname, "../../assets/pieces/cburnett"),
    path.resolve(process.cwd(), "assets/pieces/cburnett"),
    path.resolve(process.cwd(), "apps/backend/assets/pieces/cburnett"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  throw new Error(
    `[BoardImageService] Cannot locate cburnett piece SVGs directory. Checked: ${candidates.join(", ")}`
  );
}

function getPieceInnerSvg(key: PieceKey): string {
  const cached = pieceInnerSvgCache.get(key);
  if (cached) return cached;

  const dir = resolvePiecesDir();
  const raw = fs.readFileSync(path.join(dir, `${key}.svg`), "utf8");
  const inner = raw
    .replace(/^[\s\S]*?<svg[^>]*>/i, "")
    .replace(/<\/svg>\s*$/i, "");
  pieceInnerSvgCache.set(key, inner);
  return inner;
}

function squareToFileRank(sq: string): { file: number; rank: number } | null {
  if (sq.length < 2) return null;
  const file = sq.charCodeAt(0) - 97; // 'a' -> 0 .. 'h' -> 7
  const rank = Number(sq[1]) - 1; // '1' -> 0 .. '8' -> 7
  if (file < 0 || file > 7 || rank < 0 || rank > 7 || Number.isNaN(rank)) {
    return null;
  }
  return { file, rank };
}

export interface RenderBoardPngOptions {
  fen: string;
  orientation: "white" | "black";
  lastMoveUci?: string;
  size?: number;
}

/**
 * Renders a 600x600 PNG chessboard from a FEN string using cburnett SVG pieces
 * and @resvg/resvg-js.
 */
export function renderBoardPng(options: RenderBoardPngOptions): Buffer {
  const boardSize = options.size ?? 600;
  const sqSize = boardSize / 8;
  const isBlackPov = options.orientation === "black";

  // Lichess / ExtraPawn classic brown-cream board colors & last-move highlight
  const lightSquareColor = "#f0d9b5";
  const darkSquareColor = "#b58863";
  const highlightLight = "#cdd26a";
  const highlightDark = "#aaa23a";

  const highlightedSquares = new Set<string>();
  if (options.lastMoveUci && options.lastMoveUci.length >= 4) {
    const fromSq = options.lastMoveUci.slice(0, 2);
    const toSq = options.lastMoveUci.slice(2, 4);
    const f = squareToFileRank(fromSq);
    const t = squareToFileRank(toSq);
    if (f) highlightedSquares.add(`${f.file},${f.rank}`);
    if (t) highlightedSquares.add(`${t.file},${t.rank}`);
  }

  // Parse FEN placement
  const placement = options.fen.trim().split(/\s+/)[0] ?? "";
  const ranks = placement.split("/");
  if (ranks.length !== 8) {
    throw new Error(`[BoardImageService] Invalid FEN placement: ${options.fen}`);
  }

  const piecesOnBoard: { file: number; rank: number; piece: PieceKey }[] = [];
  for (let rIdx = 0; rIdx < 8; rIdx++) {
    const rankNum = 7 - rIdx; // 7 (rank 8) down to 0 (rank 1)
    const rowStr = ranks[rIdx] ?? "";
    let fileNum = 0;
    for (const ch of rowStr) {
      if (ch >= "1" && ch <= "8") {
        fileNum += Number(ch);
      } else {
        const pieceKey = FEN_CHAR_TO_PIECE_KEY[ch];
        if (!pieceKey) {
          throw new Error(
            `[BoardImageService] Unknown FEN piece character '${ch}' in ${options.fen}`
          );
        }
        piecesOnBoard.push({ file: fileNum, rank: rankNum, piece: pieceKey });
        fileNum += 1;
      }
    }
  }

  const svgParts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${boardSize}" height="${boardSize}" viewBox="0 0 ${boardSize} ${boardSize}">`,
  ];

  // 1. Draw 64 squares + coordinates
  for (let visualRow = 0; visualRow < 8; visualRow++) {
    for (let visualCol = 0; visualCol < 8; visualCol++) {
      const file = isBlackPov ? 7 - visualCol : visualCol;
      const rank = isBlackPov ? visualRow : 7 - visualRow;
      const isLight = (file + rank) % 2 === 1;
      const isHighlighted = highlightedSquares.has(`${file},${rank}`);

      const fill = isHighlighted
        ? isLight
          ? highlightLight
          : highlightDark
        : isLight
          ? lightSquareColor
          : darkSquareColor;

      const x = visualCol * sqSize;
      const y = visualRow * sqSize;

      svgParts.push(
        `<rect x="${x}" y="${y}" width="${sqSize}" height="${sqSize}" fill="${fill}" />`
      );

      const coordColor = isLight ? darkSquareColor : lightSquareColor;

      // Rank coordinate on the right-most column (visualCol === 7)
      if (visualCol === 7) {
        const rankLabel = String(rank + 1);
        svgParts.push(
          `<text x="${x + sqSize - 5}" y="${y + 16}" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="bold" fill="${coordColor}">${rankLabel}</text>`
        );
      }

      // File coordinate on the bottom-most row (visualRow === 7)
      if (visualRow === 7) {
        const fileLabel = String.fromCharCode(97 + file);
        svgParts.push(
          `<text x="${x + 5}" y="${y + sqSize - 5}" text-anchor="start" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="bold" fill="${coordColor}">${fileLabel}</text>`
        );
      }
    }
  }

  // 2. Draw pieces
  for (const item of piecesOnBoard) {
    const visualCol = isBlackPov ? 7 - item.file : item.file;
    const visualRow = isBlackPov ? item.rank : 7 - item.rank;
    const x = visualCol * sqSize;
    const y = visualRow * sqSize;
    const inner = getPieceInnerSvg(item.piece);
    svgParts.push(
      `<svg x="${x}" y="${y}" width="${sqSize}" height="${sqSize}" viewBox="0 0 45 45">${inner}</svg>`
    );
  }

  svgParts.push(`</svg>`);

  const svgString = svgParts.join("");
  const resvg = new Resvg(svgString, {
    fitTo: {
      mode: "width",
      value: boardSize,
    },
  });

  return resvg.render().asPng();
}
