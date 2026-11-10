import { ref } from "vue";

export type StockfishArrowBrush = "green" | "blue" | "red";

export interface WasmPvLine {
  multipv: number;
  depth: number;
  evalLabel: string;
  moverCp: number | null;
  moverMate: number | null;
  bestMoveUci: string;
  pvUci: string[];
  arrowBrush: StockfishArrowBrush;
}

export interface WasmAnalysisState {
  isReady: boolean;
  isLoading: boolean;
  isAnalyzing: boolean;
  error: string | null;
  depth: number;
  evalLabel: string;
  evalWhitePercent: number;
  bestMoveUci: string | null;
  bestMoveBrush: StockfishArrowBrush;
  pvLine: string[];
  lines: WasmPvLine[];
}

function classifyMoverEvaluation(
  moverCp: number | null,
  moverMate: number | null
): StockfishArrowBrush {
  if (moverMate !== null) {
    return moverMate > 0 ? "green" : "red";
  }
  if (moverCp === null) return "blue";
  if (moverCp >= 100) return "green";
  if (moverCp <= -100) return "red";
  return "blue";
}

export function useStockfishWasm() {
  const state = ref<WasmAnalysisState>({
    isReady: false,
    isLoading: false,
    isAnalyzing: false,
    error: null,
    depth: 0,
    evalLabel: "0.0",
    evalWhitePercent: 50,
    bestMoveUci: null,
    bestMoveBrush: "blue",
    pvLine: [],
    lines: [],
  });

  let worker: Worker | null = null;
  let currentSideToMove: "w" | "b" = "w";
  let pendingRequest: { fen: string; depth: number } | null = null;
  const lineMap = new Map<number, WasmPvLine>();

  function dispatchAnalysisToWorker(w: Worker, fen: string, depth: number): void {
    const parts = fen.trim().split(/\s+/);
    currentSideToMove = parts[1] === "b" ? "b" : "w";

    lineMap.clear();
    state.value.isAnalyzing = true;
    state.value.depth = 0;
    state.value.bestMoveUci = null;
    state.value.bestMoveBrush = "blue";
    state.value.pvLine = [];
    state.value.lines = [];

    w.postMessage("stop");
    w.postMessage(`position fen ${fen}`);
    w.postMessage(`go depth ${depth}`);
  }

  function ensureWorker(): Worker {
    if (worker) return worker;

    state.value.isLoading = true;
    state.value.error = null;
    worker = new Worker("/stockfish/stockfish-19-lite-single.js");

    worker.onerror = (err: ErrorEvent) => {
      state.value.isLoading = false;
      state.value.isAnalyzing = false;
      state.value.error = err.message || "Stockfish WASM load error";
    };

    worker.onmessage = (event: MessageEvent<unknown>) => {
      const line = typeof event.data === "string" ? event.data.trim() : "";
      if (!line) return;

      if (line === "uciok") {
        worker?.postMessage("setoption name MultiPV value 3");
        worker?.postMessage("isready");
        return;
      }

      if (line === "readyok") {
        state.value.isReady = true;
        state.value.isLoading = false;
        if (pendingRequest && worker) {
          const req = pendingRequest;
          pendingRequest = null;
          dispatchAnalysisToWorker(worker, req.fen, req.depth);
        }
        return;
      }

      if (line.startsWith("info ") && line.includes(" pv ")) {
        const depthMatch = line.match(/\bdepth\s+(\d+)/);
        const multipvMatch = line.match(/\bmultipv\s+(\d+)/);
        const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
        const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
        const pvIdx = line.indexOf(" pv ");

        if (pvIdx === -1) return;

        const pvMoves = line
          .slice(pvIdx + 4)
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        const firstMove = pvMoves[0];
        if (!firstMove) return;

        const multipv = multipvMatch?.[1] ? Number(multipvMatch[1]) : 1;
        if (multipv < 1 || multipv > 3) return;

        const depth = depthMatch?.[1] ? Number(depthMatch[1]) : state.value.depth;
        const sign = currentSideToMove === "w" ? 1 : -1;

        let moverCp: number | null = null;
        let moverMate: number | null = null;
        let evalLabel = "0.0";
        let whitePercent = 50;

        if (mateMatch?.[1]) {
          moverMate = Number(mateMatch[1]);
          const whiteMate = moverMate * sign;
          evalLabel =
            whiteMate > 0
              ? `+M${Math.abs(whiteMate)}`
              : `-M${Math.abs(whiteMate)}`;
          whitePercent = whiteMate > 0 ? 98 : 2;
        } else if (cpMatch?.[1]) {
          moverCp = Number(cpMatch[1]);
          const whiteCp = moverCp * sign;
          const pawns = whiteCp / 100;
          evalLabel = pawns > 0 ? `+${pawns.toFixed(1)}` : pawns.toFixed(1);
          const clamped = Math.max(-800, Math.min(800, whiteCp));
          whitePercent = Math.round(50 + (clamped / 800) * 46);
        }

        const arrowBrush = classifyMoverEvaluation(moverCp, moverMate);

        lineMap.set(multipv, {
          multipv,
          depth,
          evalLabel,
          moverCp,
          moverMate,
          bestMoveUci: firstMove,
          pvUci: pvMoves.slice(0, 6),
          arrowBrush,
        });

        const sortedLines = Array.from(lineMap.values()).sort(
          (a, b) => a.multipv - b.multipv
        );
        state.value.lines = sortedLines;

        if (multipv === 1) {
          state.value.depth = depth;
          state.value.evalLabel = evalLabel;
          state.value.evalWhitePercent = whitePercent;
          state.value.bestMoveUci = firstMove;
          state.value.bestMoveBrush = arrowBrush;
          state.value.pvLine = pvMoves.slice(0, 6);
        }
      } else if (line.startsWith("bestmove ")) {
        state.value.isAnalyzing = false;
        const parts = line.split(/\s+/);
        if (parts[1] && parts[1] !== "(none)" && !state.value.bestMoveUci) {
          state.value.bestMoveUci = parts[1];
        }
      }
    };

    worker.postMessage("uci");
    return worker;
  }

  function analyzeFen(fen: string, depth: number = 15): void {
    const w = ensureWorker();
    if (!state.value.isReady) {
      pendingRequest = { fen, depth };
      state.value.isAnalyzing = true;
      return;
    }
    dispatchAnalysisToWorker(w, fen, depth);
  }

  function stopAnalysis(): void {
    pendingRequest = null;
    if (!worker) return;
    worker.postMessage("stop");
    state.value.isAnalyzing = false;
  }

  function destroyWorker(): void {
    pendingRequest = null;
    lineMap.clear();
    if (!worker) return;
    worker.postMessage("quit");
    worker.terminate();
    worker = null;
    state.value.isReady = false;
    state.value.isLoading = false;
    state.value.isAnalyzing = false;
  }

  return {
    state,
    analyzeFen,
    stopAnalysis,
    destroyWorker,
  };
}
