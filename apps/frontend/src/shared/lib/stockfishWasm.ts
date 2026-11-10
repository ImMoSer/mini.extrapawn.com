import { ref } from "vue";

export interface WasmAnalysisState {
  isReady: boolean;
  isLoading: boolean;
  isAnalyzing: boolean;
  error: string | null;
  depth: number;
  evalLabel: string;
  evalWhitePercent: number;
  bestMoveUci: string | null;
  pvLine: string[];
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
    pvLine: [],
  });

  let worker: Worker | null = null;
  let currentSideToMove: "w" | "b" = "w";
  let pendingRequest: { fen: string; depth: number } | null = null;

  function dispatchAnalysisToWorker(w: Worker, fen: string, depth: number): void {
    const parts = fen.trim().split(/\s+/);
    currentSideToMove = parts[1] === "b" ? "b" : "w";

    state.value.isAnalyzing = true;
    state.value.depth = 0;
    state.value.bestMoveUci = null;
    state.value.pvLine = [];

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
      const line =
        typeof event.data === "string" ? event.data.trim() : "";
      if (!line) return;

      if (line === "uciok") {
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
        const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
        const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
        const pvIdx = line.indexOf(" pv ");

        if (depthMatch?.[1]) {
          state.value.depth = Number(depthMatch[1]);
        }

        const sign = currentSideToMove === "w" ? 1 : -1;

        if (mateMatch?.[1]) {
          const rawMate = Number(mateMatch[1]) * sign;
          state.value.evalLabel =
            rawMate > 0 ? `+M${Math.abs(rawMate)}` : `-M${Math.abs(rawMate)}`;
          state.value.evalWhitePercent = rawMate > 0 ? 98 : 2;
        } else if (cpMatch?.[1]) {
          const whiteCp = Number(cpMatch[1]) * sign;
          const pawns = whiteCp / 100;
          state.value.evalLabel =
            pawns > 0 ? `+${pawns.toFixed(1)}` : pawns.toFixed(1);
          const clamped = Math.max(-800, Math.min(800, whiteCp));
          state.value.evalWhitePercent = Math.round(
            50 + (clamped / 800) * 46
          );
        }

        if (pvIdx !== -1) {
          const pvMoves = line
            .slice(pvIdx + 4)
            .trim()
            .split(/\s+/)
            .filter(Boolean);
          state.value.pvLine = pvMoves.slice(0, 6);
          state.value.bestMoveUci = pvMoves[0] ?? null;
        }
      } else if (line.startsWith("bestmove ")) {
        state.value.isAnalyzing = false;
        const parts = line.split(/\s+/);
        if (parts[1] && parts[1] !== "(none)") {
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

