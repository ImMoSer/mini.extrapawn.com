import type { Key } from "@lichess-org/chessground/types";
import { computed, ref } from "vue";
import { apiRequest } from "@/shared/api/httpClient";
import type {
  CoachExplanation,
  CoachLastMoveAnalysis,
  CoachTopMove,
} from "@/shared/lib/coach/coach.types";
import {
  parseVisualCommands,
  type CoachDrawShape,
} from "@/shared/lib/coach/visualizer";

function getBrushForQuality(quality?: string | null): string {
  switch (quality) {
    case "brilliant":
      return "cyan";
    case "great":
    case "best":
    case "excellent":
      return "green";
    case "good":
      return "blue";
    case "neutral":
      return "gray";
    case "inaccuracy":
      return "yellow";
    case "mistake":
      return "orange";
    case "blunder":
    case "missed_mate":
      return "red";
    default:
      return "green";
  }
}

export function useCoachAnalysis() {
  const isAnalyzing = ref(false);
  const error = ref<string | null>(null);
  const posExplanation = ref<CoachExplanation | null>(null);
  const selectedMoveIndex = ref<number>(0);
  const showVisuals = ref(true);

  const cache = new Map<string, CoachExplanation>();
  let latestToken = 0;

  const topMoves = computed<CoachTopMove[]>(() => {
    const candidates =
      posExplanation.value?.engine_candidates ||
      posExplanation.value?.engine_top_moves ||
      [];
    return candidates.map((c, index) => ({
      rank: c.rank || index + 1,
      san: c.san || "",
      uci: c.uci || "",
      move: c.uci || "",
      quality: c.quality,
      eval_pawns: typeof c.eval_pawns === "number" ? c.eval_pawns : 0,
      isMate: Boolean(c.isMate ?? c.is_mate),
      mateIn: c.mateIn ?? c.mate_in ?? null,
      mate: c.mateIn ?? c.mate_in ?? null,
      motifs: Array.isArray(c.motifs) ? c.motifs : [],
      targetsKing: Boolean(c.targetsKing ?? c.targets_king),
      headline: c.headline || null,
      tagline: c.tagline || null,
      plan_theme: c.plan_theme || null,
      plan_brief: c.plan_brief || null,
      character: c.character || "Solid",
      character_reason: c.character_reason || "",
      wdl: c.wdl,
      whiteP: c.whiteP ?? null,
      drawP: c.drawP ?? null,
      blackP: c.blackP ?? null,
      winP: c.winP ?? null,
      lossP: c.lossP ?? null,
      popularity: c.popularity ?? null,
      totalGames: c.totalGames ?? null,
      theoreticalContinuations: c.theoreticalContinuations,
      pvLine: Array.isArray(c.pv_line) ? c.pv_line : c.pvLine || [],
      explanation: c.explanation,
      visual_commands: c.visual_commands || null,
    }));
  });

  const lastMoveAnalysis = computed<CoachLastMoveAnalysis | null>(() => {
    const lma = posExplanation.value?.last_move_analysis;
    if (!lma) return null;
    const moveSan = lma.san || lma.move_san || "";
    const detailsStr = Array.isArray(lma.details)
      ? lma.details.join(" ")
      : lma.details || undefined;
    return {
      ...lma,
      loading: isAnalyzing.value,
      san: moveSan,
      details: detailsStr,
    };
  });

  const sideToMove = computed<"w" | "b">(() => {
    const status = posExplanation.value?.position_status;
    if (status?.side_to_move) {
      return status.side_to_move === "b" ? "b" : "w";
    }
    return posExplanation.value?.side_to_move === "black" ? "b" : "w";
  });

  const phase = computed<string>(() => {
    return (
      posExplanation.value?.position_status?.phase ||
      posExplanation.value?.game_phase ||
      posExplanation.value?.phase ||
      "middlegame"
    );
  });

  const materialDelta = computed<number>(() => {
    return (
      posExplanation.value?.position_status?.material_delta ??
      posExplanation.value?.material_imbalance ??
      0
    );
  });

  const openingName = computed<string | null>(() => {
    const exp = posExplanation.value;
    if (!exp) return null;
    if (exp.opening_info?.name) {
      const eco =
        exp.opening_info.eco && exp.opening_info.eco !== "-"
          ? `${exp.opening_info.eco} · `
          : "";
      return `${eco}${exp.opening_info.name}`;
    }
    if (exp.opening_name) {
      const eco =
        exp.opening_eco && exp.opening_eco !== "-"
          ? `${exp.opening_eco} · `
          : "";
      return `${eco}${exp.opening_name}`;
    }
    return null;
  });

  const lastMoveConsequence = computed<string | null>(() => {
    const exp = posExplanation.value;
    if (!exp) return null;
    const lma = exp.last_move_analysis;
    if (lma?.consequence) return lma.consequence;
    const topTheme =
      exp.strategic_themes?.[0]?.description || exp.themes?.[0]?.description;
    return topTheme || exp.strategic_summary || exp.key_imbalance || null;
  });

  const drawableShapes = computed<CoachDrawShape[]>(() => {
    if (!showVisuals.value || !posExplanation.value) return [];
    const shapes: CoachDrawShape[] = [];

    // 1. Last move NAG badge
    const lma = posExplanation.value.last_move_analysis;
    const lmaUci = lma?.move_uci || lma?.uci;
    if (typeof lmaUci === "string" && lmaUci.length >= 4 && lma?.quality) {
      shapes.push({
        orig: lmaUci.slice(2, 4) as Key,
        customNag: lma.quality,
      });
    }

    // 2. Selected candidate arrow + NAG badge + visual_commands
    const selectedMove =
      topMoves.value[selectedMoveIndex.value] ?? topMoves.value[0];
    const moveUci = selectedMove?.uci || selectedMove?.move;

    if (moveUci && moveUci.length >= 4) {
      const orig = moveUci.slice(0, 2) as Key;
      const dest = moveUci.slice(2, 4) as Key;
      const quality =
        selectedMove?.quality ||
        selectedMove?.explanation?.quality ||
        (selectedMoveIndex.value === 0
          ? posExplanation.value.principal_plan?.moves?.[0]?.quality
          : undefined);

      shapes.push({
        orig,
        dest,
        brush: getBrushForQuality(quality),
        modifiers: { lineWidth: 8 },
      });

      if (quality) {
        shapes.push({
          orig: dest,
          customNag: quality,
        });
      }
    }

    // 3. Tactical / Strategic visual_commands (100% compatible with app_vue visualizer.ts)
    const vis = selectedMove?.visual_commands ?? posExplanation.value.visual_commands;
    if (vis) {
      let cmdStr = "";
      if (typeof vis === "string") {
        cmdStr = vis;
      } else if (typeof vis === "object") {
        cmdStr = Object.entries(vis)
          .filter(([k, v]) => !k.startsWith("_") && typeof v === "string" && Boolean(v))
          .map(([, v]) => v as string)
          .join(";");
      }
      if (cmdStr) {
        shapes.push(...parseVisualCommands(cmdStr));
      }
    } else if (posExplanation.value.action) {
      shapes.push(...parseVisualCommands(posExplanation.value.action));
    }

    return shapes;
  });

  async function analyzePosition(
    startFen: string,
    moves: string[]
  ): Promise<void> {
    const key = `${startFen}|${moves.join(" ")}`;
    const cached = cache.get(key);
    if (cached) {
      error.value = null;
      posExplanation.value = cached;
      selectedMoveIndex.value = 0;
      isAnalyzing.value = false;
      return;
    }

    const token = ++latestToken;
    isAnalyzing.value = true;
    error.value = null;

    try {
      const data = await apiRequest<CoachExplanation>("/coach-engine/uci_fen", {
        method: "POST",
        body: JSON.stringify({
          start_fen: startFen,
          moves,
        }),
      });

      if (token !== latestToken) return;
      cache.set(key, data);
      posExplanation.value = data;
      selectedMoveIndex.value = 0;
    } catch (err) {
      if (token !== latestToken) return;
      error.value =
        err instanceof Error ? err.message : "Coach Engine unavailable";
    } finally {
      if (token === latestToken) {
        isAnalyzing.value = false;
      }
    }
  }

  function resetCoach(): void {
    latestToken += 1;
    isAnalyzing.value = false;
    error.value = null;
    posExplanation.value = null;
    selectedMoveIndex.value = 0;
  }

  function selectMove(index: number): void {
    selectedMoveIndex.value = index;
  }

  function toggleVisuals(): void {
    showVisuals.value = !showVisuals.value;
  }

  return {
    isAnalyzing,
    error,
    posExplanation,
    selectedMoveIndex,
    showVisuals,
    topMoves,
    lastMoveAnalysis,
    sideToMove,
    phase,
    materialDelta,
    openingName,
    lastMoveConsequence,
    drawableShapes,
    analyzePosition,
    resetCoach,
    selectMove,
    toggleVisuals,
  };
}

