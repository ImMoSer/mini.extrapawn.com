import { ref } from "vue";

export interface WasmAnalysisState {
  isReady: boolean;
  isAnalyzing: boolean;
  depth: number;
  evalLabel: string;
  evalWhitePercent: number;
  bestMoveUci: string | null;
  pvLine: string[];
}

export function useStockfishWasm() {
  const state = ref<WasmAnalysisState>({
    isReady: false,
    isAnalyzing: false,
    depth: 0,
    evalLabel: "0.0",
    evalWhitePercent: 50,
    bestMoveUci: null,
    pvLine: [],
  });

  let worker: Worker | null = null;
  let currentSideToMove: "w" | "b" = "w";

  function ensureWorker(): Worker {
    if (worker) return worker;
    worker = new Worker("/stockfish/stockfish-19-single.js");
    worker.onmessage = (event: MessageEvent<string>) => {
      const line = String(event.data || "").trim();
      if (!line) return;

      if (line === "uciok" || line === "readyok") {
        state.value.isReady = true;
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
    worker.postMessage("isready");
    return worker;
  }

  function analyzeFen(fen: string, depth: number = 15): void {
    const w = ensureWorker();
    const parts = fen.trim().split(/\s+/);
    currentSideToMove = parts[1] === "b" ? "b" : "w";

    state.value.isAnalyzing = true;
    state.value.bestMoveUci = null;
    state.value.pvLine = [];

    w.postMessage("stop");
    w.postMessage(`position fen ${fen}`);
    w.postMessage(`go depth ${depth}`);
  }

  function stopAnalysis(): void {
    if (!worker) return;
    worker.postMessage("stop");
    state.value.isAnalyzing = false;
  }

  function destroyWorker(): void {
    if (!worker) return;
    worker.postMessage("quit");
    worker.terminate();
    worker = null;
  }

  return {
    state,
    analyzeFen,
    stopAnalysis,
    destroyWorker,
  };
}

