<script setup lang="ts">
import type {
  CoachExplanation,
  CoachLastMoveAnalysis,
  CoachTopMove,
} from "@/shared/lib/coach/coach.types";
import QualityIcon from "./QualityIcon.vue";

const props = defineProps<{
  isAnalyzing: boolean;
  error: string | null;
  sideToMove: "w" | "b";
  phase: string;
  materialDelta: number;
  openingName: string | null;
  lastMoveAnalysis: CoachLastMoveAnalysis | null;
  lastMoveConsequence: string | null;
  posExplanation: CoachExplanation | null;
  topMoves: CoachTopMove[];
  selectedMoveIndex: number;
  showVisuals: boolean;
}>();

const emit = defineEmits<{
  (e: "select-move", index: number): void;
  (e: "toggle-visuals"): void;
}>();

const QUALITY_BG: Record<string, string> = {
  brilliant: "var(--color-mint)",
  great: "var(--color-success)",
  best: "var(--color-success)",
  excellent: "var(--color-success)",
  good: "var(--color-info)",
  neutral: "var(--color-text-secondary)",
  inaccuracy: "var(--color-warning)",
  mistake: "var(--color-orange)",
  blunder: "var(--color-danger)",
  missed_mate: "var(--color-danger)",
};

const QUALITY_LABEL: Record<string, string> = {
  brilliant: "Brilliant",
  great: "Great",
  best: "Best",
  excellent: "Excellent",
  good: "Good",
  neutral: "Neutral",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
  missed_mate: "Missed mate",
};

function getQualityColor(q: string): string {
  return QUALITY_BG[q] || "var(--color-text-secondary)";
}

function getQualityLabel(q: string): string {
  return QUALITY_LABEL[q] || "";
}

function getMoveQuality(move: CoachTopMove, idx: number): string | null {
  if (move.quality) return move.quality;
  if (move.explanation?.quality) return move.explanation.quality;
  const firstMove = props.posExplanation?.principal_plan?.moves?.[0];
  if (idx === 0 && firstMove?.quality) {
    return firstMove.quality;
  }
  return null;
}

function characterColor(label: string): string {
  switch (label) {
    case "Aggressive":
      return "var(--color-danger)";
    case "Combative":
      return "var(--color-orange)";
    case "Forcing":
      return "var(--color-warning)";
    case "Risky":
      return "var(--color-highlight)";
    case "Positional":
      return "var(--color-success)";
    case "Solid":
      return "var(--color-info)";
    default:
      return "var(--color-text-secondary)";
  }
}

function getWdl(
  move: CoachTopMove
): { white: number; draw: number; black: number } | null {
  const wdlObj = move.wdl as Record<string, number> | undefined;
  if (
    wdlObj &&
    typeof wdlObj.white === "number" &&
    typeof wdlObj.draw === "number" &&
    typeof wdlObj.black === "number"
  ) {
    return { white: wdlObj.white, draw: wdlObj.draw, black: wdlObj.black };
  }
  if (
    typeof move.whiteP === "number" &&
    typeof move.drawP === "number" &&
    typeof move.blackP === "number"
  ) {
    return { white: move.whiteP, draw: move.drawP, black: move.blackP };
  }
  if (
    typeof move.winP === "number" &&
    typeof move.drawP === "number" &&
    typeof move.lossP === "number"
  ) {
    const isWhite = props.sideToMove === "w";
    return {
      white: isWhite ? move.winP : move.lossP,
      draw: move.drawP,
      black: isWhite ? move.lossP : move.winP,
    };
  }
  return null;
}

function getEvalBadgeInfo(move: CoachTopMove) {
  if (
    move.isMate ||
    (move.mateIn !== null && move.mateIn !== undefined && move.mateIn !== 0)
  ) {
    const m = move.mateIn ?? 0;
    if (m > 0) {
      return {
        text: `+M${m}`,
        color: "var(--color-success)",
        bg: "color-mix(in srgb, var(--color-success) 12%, transparent)",
        border: "color-mix(in srgb, var(--color-success) 30%, transparent)",
      };
    }
    if (m < 0) {
      return {
        text: `-M${Math.abs(m)}`,
        color: "var(--color-danger)",
        bg: "color-mix(in srgb, var(--color-danger) 12%, transparent)",
        border: "color-mix(in srgb, var(--color-danger) 30%, transparent)",
      };
    }
  }

  if (typeof move.eval_pawns === "number") {
    if (move.eval_pawns > 0) {
      return {
        text: `+${move.eval_pawns.toFixed(2)}`,
        color: "var(--color-success)",
        bg: "color-mix(in srgb, var(--color-success) 12%, transparent)",
        border: "color-mix(in srgb, var(--color-success) 30%, transparent)",
      };
    }
    if (move.eval_pawns < 0) {
      return {
        text: move.eval_pawns.toFixed(2),
        color: "var(--color-danger)",
        bg: "color-mix(in srgb, var(--color-danger) 12%, transparent)",
        border: "color-mix(in srgb, var(--color-danger) 30%, transparent)",
      };
    }
    return {
      text: "0.00",
      color: "var(--color-text-secondary)",
      bg: "color-mix(in srgb, var(--color-text-secondary) 10%, transparent)",
      border: "color-mix(in srgb, var(--color-text-secondary) 20%, transparent)",
    };
  }

  return {
    text: "--",
    color: "var(--color-text-secondary)",
    bg: "color-mix(in srgb, var(--color-text-secondary) 10%, transparent)",
    border: "color-mix(in srgb, var(--color-text-secondary) 20%, transparent)",
  };
}

function getStrategicThemes() {
  const raw =
    props.posExplanation?.strategic_themes || props.posExplanation?.themes || [];
  return raw
    .filter((th) => th && th.description && th.strength >= 30)
    .slice(0, 3);
}
</script>

<template>
  <section class="glass flex flex-col overflow-hidden text-text-primary">
    <!-- Compact Header Bar -->
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-elevated/40 px-2.5 py-1.5 text-[11px]">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="font-bold tracking-wider text-brand uppercase">COACH</span>
        <span class="text-text-disabled">·</span>
        <span
          class="h-2 w-2 shrink-0 rounded-full border"
          :class="
            sideToMove === 'w'
              ? 'border-text-primary bg-text-primary'
              : 'border-border-hover bg-surface'
          "
        />
        <span class="font-medium text-text-primary">
          {{ sideToMove === "w" ? "White" : "Black" }}
        </span>
        <span class="text-text-disabled">·</span>
        <span class="text-text-secondary capitalize">{{ phase }}</span>
        <template v-if="Math.abs(materialDelta) >= 0.1">
          <span class="text-text-disabled">·</span>
          <span class="font-condensed font-bold text-success">
            {{ materialDelta > 0 ? "W" : "B" }} +{{
              Math.abs(materialDelta).toFixed(1)
            }}
          </span>
        </template>
      </div>

      <div class="flex items-center gap-1.5">
        <span v-if="isAnalyzing" class="text-[10px] font-semibold text-brand">
          ⏳ Анализ...
        </span>
        <button
          type="button"
          class="rounded border px-1.5 py-0.5 text-[10px] font-bold transition"
          :class="
            showVisuals
              ? 'border-brand/40 bg-brand/15 text-brand'
              : 'border-border bg-surface text-text-secondary'
          "
          @click="emit('toggle-visuals')"
        >
          👁 Стрелки
        </button>
      </div>
    </div>

    <!-- Opening Line (if present) -->
    <div
      v-if="openingName"
      class="truncate border-b border-border bg-warning/5 px-2.5 py-1 text-[10px] font-medium text-warning"
    >
      📖 {{ openingName }}
    </div>

    <!-- Error Notice -->
    <div
      v-if="error"
      class="px-2.5 py-2 text-xs font-semibold text-danger"
    >
      ⚠️ {{ error }}
    </div>

    <!-- Compact Last Move Strip -->
    <div
      v-if="lastMoveAnalysis && lastMoveAnalysis.san"
      class="border-b border-border px-2.5 py-1.5"
    >
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-[9px] font-bold tracking-wider text-text-disabled uppercase">
          LAST
        </span>
        <span class="font-mono text-sm font-bold text-text-primary">
          {{ lastMoveAnalysis.san }}
        </span>
        <span
          v-if="!lastMoveAnalysis.loading && lastMoveAnalysis.quality"
          class="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full text-on-brand"
          :style="{ backgroundColor: getQualityColor(lastMoveAnalysis.quality) }"
        >
          <QualityIcon
            :quality="lastMoveAnalysis.quality"
            :size="11"
            color="var(--color-on-brand)"
          />
        </span>
        <span
          v-if="!lastMoveAnalysis.loading && lastMoveAnalysis.quality"
          class="rounded-full px-1.5 py-0.2 text-[9px] font-bold tracking-wider uppercase"
          :style="{
            color: getQualityColor(lastMoveAnalysis.quality),
            backgroundColor: `color-mix(in srgb, ${getQualityColor(lastMoveAnalysis.quality)} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${getQualityColor(lastMoveAnalysis.quality)} 35%, transparent)`,
          }"
        >
          {{ getQualityLabel(lastMoveAnalysis.quality) }}
        </span>
        <span
          v-if="!lastMoveAnalysis.loading && lastMoveAnalysis.summary"
          class="text-[11px] font-medium text-text-primary"
        >
          — {{ lastMoveAnalysis.summary }}
        </span>
      </div>

      <div
        v-if="!lastMoveAnalysis.loading && lastMoveAnalysis.details"
        class="mt-0.5 text-[11px] leading-tight text-text-secondary"
      >
        {{ lastMoveAnalysis.details }}
      </div>

      <div
        v-if="!lastMoveAnalysis.loading && lastMoveConsequence"
        class="mt-1 border-t border-border/60 pt-1 text-[10px] leading-tight text-text-secondary"
      >
        <span class="mr-1 font-bold tracking-wider text-text-disabled uppercase">
          {{ lastMoveAnalysis.consequence ? "Consequence:" : "Key Factor:" }}
        </span>
        <span class="text-text-primary">{{ lastMoveConsequence }}</span>
      </div>
    </div>

    <!-- Compact Key Positional Factors -->
    <div
      v-if="getStrategicThemes().length > 0"
      class="border-b border-border bg-elevated/20 px-2.5 py-1.5"
    >
      <div class="mb-0.5 text-[9px] font-bold tracking-widest text-text-secondary uppercase">
        Positional Factors
      </div>
      <ul class="space-y-0.5">
        <li
          v-for="th in getStrategicThemes()"
          :key="`${th.id}-${th.side}`"
          class="flex items-baseline gap-1.5 text-[11px] leading-tight text-text-secondary"
        >
          <span
            class="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full"
            :class="th.strength >= 80 ? 'bg-warning' : 'bg-brand'"
          />
          <span>{{ th.description }}</span>
        </li>
      </ul>
    </div>

    <!-- Compact Engine Candidates -->
    <div class="flex flex-col gap-1.5 p-2">
      <div class="flex items-center justify-between px-0.5 text-[9px] font-bold tracking-widest text-text-secondary uppercase">
        <span>Engine Candidates</span>
        <span v-if="topMoves.length > 0" class="font-normal text-text-disabled">
          нажмите для плана на доске
        </span>
      </div>

      <div
        v-if="topMoves.length === 0 && !isAnalyzing && !error"
        class="px-1 py-1 text-xs text-text-secondary italic"
      >
        Нет доступных кандидатов для этой позиции.
      </div>

      <div
        v-for="(move, idx) in topMoves"
        :key="`${move.uci}-${idx}`"
        class="cursor-pointer rounded-md border px-2 py-1.5 transition-colors"
        :class="
          selectedMoveIndex === idx
            ? 'border-brand/50 bg-elevated'
            : 'border-border bg-surface hover:border-border-hover'
        "
        @click="emit('select-move', idx)"
      >
        <!-- Row 1: Rank, SAN, NAG, Character, Tagline, Eval -->
        <div class="flex flex-wrap items-center gap-1.5">
          <span
            class="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-bold"
            :class="
              idx === 0
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border-hover bg-canvas text-text-secondary'
            "
          >
            {{ move.rank }}
          </span>

          <span
            class="font-mono text-[13px] font-bold tracking-tight"
            :class="idx === 0 ? 'text-success' : 'text-text-primary'"
          >
            {{ move.san }}
          </span>

          <span
            v-if="getMoveQuality(move, idx)"
            class="inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-on-brand"
            :style="{
              backgroundColor: getQualityColor(getMoveQuality(move, idx) || ''),
            }"
          >
            <QualityIcon
              :quality="getMoveQuality(move, idx) || ''"
              :size="11"
              color="var(--color-on-brand)"
            />
          </span>

          <span
            v-if="move.character && move.character !== 'Quiet'"
            class="rounded border px-1 py-0 text-[9px] font-bold tracking-wider uppercase"
            :style="{
              color: characterColor(move.character),
              borderColor: `color-mix(in srgb, ${characterColor(move.character)} 35%, transparent)`,
              backgroundColor: `color-mix(in srgb, ${characterColor(move.character)} 10%, transparent)`,
            }"
          >
            {{ move.character }}
          </span>

          <span
            v-if="move.tagline"
            class="min-w-0 flex-1 truncate text-[11px] font-medium text-text-secondary"
          >
            {{ move.tagline }}
          </span>

          <span
            class="ml-auto rounded-full border px-1.5 py-0.2 font-mono text-[10px] font-bold"
            :style="{
              backgroundColor: getEvalBadgeInfo(move).bg,
              color: getEvalBadgeInfo(move).color,
              borderColor: getEvalBadgeInfo(move).border,
            }"
          >
            {{ getEvalBadgeInfo(move).text }}
          </span>
        </div>

        <!-- Compact W/D/L Bar -->
        <div
          v-if="getWdl(move)"
          class="mt-1 flex items-center gap-2 text-[9px] font-mono"
        >
          <span class="shrink-0 font-bold text-success">
            {{ getWdl(move)!.white }}%W
          </span>
          <div class="flex h-1.5 flex-1 overflow-hidden rounded-full border border-border bg-canvas">
            <div
              class="h-full bg-success"
              :style="{ width: `${getWdl(move)!.white}%` }"
            />
            <div
              class="h-full bg-accent"
              :style="{ width: `${getWdl(move)!.draw}%` }"
            />
            <div
              class="h-full bg-danger"
              :style="{ width: `${getWdl(move)!.black}%` }"
            />
          </div>
          <span class="shrink-0 font-bold text-accent">
            {{ getWdl(move)!.draw }}%D
          </span>
          <span class="shrink-0 font-bold text-danger">
            {{ getWdl(move)!.black }}%L
          </span>
        </div>

        <!-- Expanded Details & Compact Continuation ONLY for selected candidate -->
        <div
          v-if="selectedMoveIndex === idx"
          class="mt-1 flex flex-col gap-0.5 text-[11px] leading-tight"
        >
          <div
            v-if="move.explanation?.summary"
            class="font-semibold text-text-primary"
          >
            {{ move.explanation.summary }}
          </div>
          <div
            v-if="move.explanation?.details"
            class="text-text-secondary"
          >
            {{ move.explanation.details }}
          </div>
          <div
            v-if="
              move.plan_brief &&
              move.plan_brief !== move.tagline &&
              move.plan_brief !== move.explanation?.details
            "
            class="text-text-secondary"
          >
            <span class="font-semibold text-text-primary">Idea:</span>
            {{ move.plan_brief }}
          </div>

          <!-- Compact Continuation Line -->
          <div
            v-if="Array.isArray(move.pvLine) && move.pvLine.length > 1"
            class="mt-1 border-t border-border/60 pt-1"
          >
            <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
              <span class="font-bold tracking-wider text-text-disabled uppercase">
                PV:
              </span>
              <span
                v-for="(p, i) in move.pvLine.slice(1)"
                :key="i"
                class="inline-flex items-baseline gap-1"
                :title="p.tagline || ''"
              >
                <span class="font-mono font-bold text-text-primary">
                  {{ Number(i) + 1 }}.{{ p.san }}
                </span>
                <span
                  v-if="p.tagline"
                  class="text-text-secondary"
                >
                  ({{ p.tagline }})
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

