<script setup lang="ts">
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Config } from "@lichess-org/chessground/config";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Color, Dests, Key } from "@lichess-org/chessground/types";
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import type { CoachDrawShape } from "@/shared/lib/coach/visualizer";
import { requiresPawnPromotion } from "../lib/chessPosition";

const props = defineProps<{
  fen: string;
  orientation: Color;
  turnColor: Color;
  dests: Dests;
  lastMove?: [Key, Key];
  check?: boolean;
  interactive?: boolean;
  shapes?: CoachDrawShape[];
  boardRevision?: number;
}>();

const emit = defineEmits<{
  (e: "move", uci: string): void;
}>();

const boardEl = ref<HTMLElement | null>(null);
const ground = shallowRef<Api | null>(null);
const pendingPromotion = ref<{ orig: Key; dest: Key } | null>(null);

const CHESSGROUND_BRUSHES = {
  green: { key: "g", color: "var(--color-success)", opacity: 0.92, lineWidth: 10 },
  red: { key: "r", color: "var(--color-danger)", opacity: 0.92, lineWidth: 10 },
  blue: { key: "b", color: "var(--color-info)", opacity: 0.92, lineWidth: 10 },
  yellow: { key: "y", color: "var(--color-warning)", opacity: 0.92, lineWidth: 10 },
  orange: { key: "o", color: "var(--color-orange)", opacity: 0.92, lineWidth: 10 },
  purple: { key: "u", color: "var(--color-accent)", opacity: 0.92, lineWidth: 10 },
  enginePlan: { key: "p", color: "var(--color-highlight)", opacity: 1, lineWidth: 10 },
  bestmove: { key: "p", color: "var(--color-highlight)", opacity: 1, lineWidth: 10 },
  cyan: { key: "c", color: "var(--color-brand)", opacity: 0.92, lineWidth: 10 },
  pink: { key: "k", color: "var(--color-highlight)", opacity: 0.92, lineWidth: 10 },
  brown: { key: "w", color: "var(--color-orange-warm)", opacity: 0.92, lineWidth: 10 },
  gray: { key: "x", color: "var(--color-text-secondary)", opacity: 0.92, lineWidth: 10 },
  paleBlue: { key: "pb", color: "var(--color-info)", opacity: 0.4, lineWidth: 15 },
  paleGreen: { key: "pg", color: "var(--color-success)", opacity: 0.4, lineWidth: 15 },

  // Coach-specific thin brushes (100% compatible with app_vue WebChessBoard.vue)
  coachgreen: { key: "G", color: "var(--color-success)", opacity: 0.55, lineWidth: 5 },
  coachred: { key: "R", color: "var(--color-danger)", opacity: 0.55, lineWidth: 5 },
  coachblue: { key: "B", color: "var(--color-info)", opacity: 0.55, lineWidth: 5 },
  coachyellow: { key: "Y", color: "var(--color-warning)", opacity: 0.55, lineWidth: 5 },
  coachorange: { key: "O", color: "var(--color-orange)", opacity: 0.55, lineWidth: 5 },
  coachpurple: { key: "U", color: "var(--color-accent)", opacity: 0.9, lineWidth: 5 },
  coachcyan: { key: "C", color: "var(--color-brand)", opacity: 0.55, lineWidth: 5 },
  coachpink: { key: "K", color: "var(--color-highlight)", opacity: 0.55, lineWidth: 5 },
  coachbrown: { key: "W", color: "var(--color-orange-warm)", opacity: 0.55, lineWidth: 5 },
  coachgray: { key: "X", color: "var(--color-text-disabled)", opacity: 0.55, lineWidth: 5 },
  coachpaleBlue: { key: "PB", color: "var(--color-info)", opacity: 0.4, lineWidth: 5 },
  coachpaleGreen: { key: "PG", color: "var(--color-success)", opacity: 0.4, lineWidth: 5 },
  coachenginePlan: { key: "P", color: "var(--color-highlight)", opacity: 0.55, lineWidth: 5 },
} as const;

const NAG_SYMBOLS: Record<string, string> = {
  brilliant: "!!",
  great: "!",
  best: "★",
  excellent: "✓",
  good: "✓",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
  missed_mate: "✕",
};

function getNagSymbol(quality: string, nag?: string): string {
  if (nag && NAG_SYMBOLS[nag]) return NAG_SYMBOLS[nag];
  if (quality && NAG_SYMBOLS[quality]) return NAG_SYMBOLS[quality];
  if (nag) return nag;
  return "!";
}

function getNagColor(quality: string): string {
  switch (quality) {
    case "brilliant":
      return "var(--color-mint)";
    case "great":
    case "best":
    case "excellent":
      return "var(--color-success)";
    case "good":
      return "var(--color-info)";
    case "neutral":
      return "var(--color-text-secondary)";
    case "inaccuracy":
      return "var(--color-warning)";
    case "mistake":
      return "var(--color-orange)";
    case "blunder":
    case "missed_mate":
      return "var(--color-danger)";
    default:
      return "var(--color-success)";
  }
}

const resolvedShapes = computed<DrawShape[]>(() => {
  const raw = props.shapes ?? [];
  const result: DrawShape[] = [];
  const nagAdded = new Set<string>();

  for (const s of raw) {
    if (s.orig && (s.nag || s.customNag) && !nagAdded.has(s.orig)) {
      const q = s.nag || s.customNag || "brilliant";
      const sym = getNagSymbol(q, s.nag);
      const color = getNagColor(q);
      result.push({
        orig: s.orig,
        customSvg: {
          html: `<g><circle cx="82" cy="18" r="14" style="fill:${color};stroke:var(--color-canvas);stroke-width:2.5px"/><text x="82" y="22.5" font-size="13" font-weight="900" font-family="sans-serif" text-anchor="middle" style="fill:var(--color-canvas)">${sym}</text></g>`,
          center: "orig",
        },
      });
      nagAdded.add(s.orig);
    } else if (s.orig && s.stepBadge) {
      const label = String(s.stepBadge);
      const badgeWidth = Math.max(26, label.length * 11);
      result.push({
        orig: s.orig,
        customSvg: {
          html: `<g><rect x="4" y="4" width="${badgeWidth}" height="20" rx="4" style="fill:var(--color-warning);stroke:var(--color-canvas);stroke-width:1.5px"/><text x="${4 + badgeWidth / 2}" y="17.5" font-size="12" font-weight="900" font-family="monospace" text-anchor="middle" style="fill:var(--color-canvas)">${label}</text></g>`,
          center: "orig",
        },
      });
    } else if (s.orig && (s.dest || s.brush)) {
      const brushKey = typeof s.brush === "string" ? s.brush : undefined;
      const safeBrush =
        brushKey && brushKey in CHESSGROUND_BRUSHES ? brushKey : "green";
      result.push({
        orig: s.orig,
        dest: s.dest,
        brush: safeBrush,
        modifiers: s.modifiers,
      });
    }
  }

  return result;
});

function handleAfterMove(orig: Key, dest: Key) {
  if (requiresPawnPromotion(props.fen, orig, dest)) {
    pendingPromotion.value = { orig, dest };
    return;
  }
  emit("move", `${orig}${dest}`);
  void nextTick(() => {
    syncGround();
  });
}

function selectPromotionPiece(roleChar: "q" | "r" | "b" | "n") {
  if (!pendingPromotion.value) return;
  const { orig, dest } = pendingPromotion.value;
  pendingPromotion.value = null;
  emit("move", `${orig}${dest}${roleChar}`);
  void nextTick(() => {
    syncGround();
  });
}

function cancelPromotion() {
  pendingPromotion.value = null;
  syncGround();
}

function syncGround() {
  if (!ground.value) return;
  ground.value.set({
    fen: props.fen,
    orientation: props.orientation,
    turnColor: props.turnColor,
    check: Boolean(props.check),
    lastMove: props.lastMove,
    movable: {
      free: false,
      color: props.interactive ? props.turnColor : undefined,
      dests: props.interactive ? props.dests : new Map(),
      showDests: true,
    },
    drawable: {
      enabled: true,
      brushes: CHESSGROUND_BRUSHES,
      autoShapes: resolvedShapes.value,
    },
  });
}

onMounted(() => {
  if (!boardEl.value) return;
  const config: Config = {
    fen: props.fen,
    orientation: props.orientation,
    turnColor: props.turnColor,
    check: Boolean(props.check),
    lastMove: props.lastMove,
    animation: {
      enabled: true,
      duration: 180,
    },
    highlight: {
      lastMove: true,
      check: true,
    },
    movable: {
      free: false,
      color: props.interactive ? props.turnColor : undefined,
      dests: props.interactive ? props.dests : new Map(),
      showDests: true,
      events: {
        after: (orig, dest) => handleAfterMove(orig, dest),
      },
    },
    drawable: {
      enabled: true,
      brushes: CHESSGROUND_BRUSHES,
      autoShapes: resolvedShapes.value,
    },
  };
  ground.value = Chessground(boardEl.value, config);
});

onUnmounted(() => {
  ground.value?.destroy();
  ground.value = null;
});

watch(
  [
    () => props.fen,
    () => props.orientation,
    () => props.turnColor,
    () => props.dests,
    () => props.lastMove,
    () => props.check,
    () => props.interactive,
    () => props.boardRevision,
    resolvedShapes,
  ],
  () => {
    syncGround();
  },
  { deep: true }
);
</script>

<template>
  <div class="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-surface select-none">
    <div ref="boardEl" class="h-full w-full"></div>

    <!-- Pawn Promotion Modal Overlay -->
    <div
      v-if="pendingPromotion"
      class="absolute inset-0 z-30 flex items-center justify-center bg-canvas/80 backdrop-blur-xs"
      @click.self="cancelPromotion"
    >
      <div class="flex flex-col items-center gap-3 rounded-xl border border-border bg-elevated p-4 shadow-xl">
        <span class="text-xs font-bold tracking-wider text-text-secondary uppercase">
          Выберите фигуру / Promote
        </span>
        <div class="flex items-center gap-2">
          <button
            v-for="item in [
              { role: 'q' as const, label: '♛ Queen' },
              { role: 'r' as const, label: '♜ Rook' },
              { role: 'b' as const, label: '♝ Bishop' },
              { role: 'n' as const, label: '♞ Knight' },
            ]"
            :key="item.role"
            type="button"
            class="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-bold text-text-primary transition hover:border-brand hover:text-brand"
            @click="selectPromotionPiece(item.role)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Make Coach-specific arrows thin and distinct (matching app_vue WebChessBoard.vue) */
:deep(.cg-shapes) g.coachgreen path,
:deep(.cg-shapes) g.coachgreen line,
:deep(.cg-shapes) g.coachred path,
:deep(.cg-shapes) g.coachred line,
:deep(.cg-shapes) g.coachblue path,
:deep(.cg-shapes) g.coachblue line,
:deep(.cg-shapes) g.coachyellow path,
:deep(.cg-shapes) g.coachyellow line,
:deep(.cg-shapes) g.coachorange path,
:deep(.cg-shapes) g.coachorange line,
:deep(.cg-shapes) g.coachpurple path,
:deep(.cg-shapes) g.coachpurple line,
:deep(.cg-shapes) g.coachcyan path,
:deep(.cg-shapes) g.coachcyan line,
:deep(.cg-shapes) g.coachpink path,
:deep(.cg-shapes) g.coachpink line,
:deep(.cg-shapes) g.coachbrown path,
:deep(.cg-shapes) g.coachbrown line,
:deep(.cg-shapes) g.coachgray path,
:deep(.cg-shapes) g.coachgray line,
:deep(.cg-shapes) g.coachpaleBlue path,
:deep(.cg-shapes) g.coachpaleBlue line,
:deep(.cg-shapes) g.coachpaleGreen path,
:deep(.cg-shapes) g.coachpaleGreen line {
  stroke-width: 0.35% !important;
}
</style>
