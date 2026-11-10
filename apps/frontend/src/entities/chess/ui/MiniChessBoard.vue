<script setup lang="ts">
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Config } from "@lichess-org/chessground/config";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Color, Dests, Key } from "@lichess-org/chessground/types";
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import { requiresPawnPromotion } from "../lib/chessPosition";

const props = defineProps<{
  fen: string;
  orientation: Color;
  turnColor: Color;
  dests: Dests;
  lastMove?: [Key, Key];
  check?: boolean;
  interactive?: boolean;
  bestMoveUci?: string | null;
}>();

const emit = defineEmits<{
  (e: "move", uci: string): void;
}>();

const boardEl = ref<HTMLElement | null>(null);
const ground = shallowRef<Api | null>(null);
const pendingPromotion = ref<{ orig: Key; dest: Key } | null>(null);

const BRUSHES = {
  green: { key: "g", color: "var(--color-success)", opacity: 0.9, lineWidth: 10 },
  red: { key: "r", color: "var(--color-danger)", opacity: 0.9, lineWidth: 10 },
  blue: { key: "b", color: "var(--color-info)", opacity: 0.9, lineWidth: 10 },
  yellow: { key: "y", color: "var(--color-warning)", opacity: 0.9, lineWidth: 10 },
  bestmove: {
    key: "p",
    color: "var(--color-highlight)",
    opacity: 0.95,
    lineWidth: 11,
  },
} as const;

const autoShapes = computed<DrawShape[]>(() => {
  if (!props.bestMoveUci || props.bestMoveUci.length < 4) return [];
  const orig = props.bestMoveUci.slice(0, 2) as Key;
  const dest = props.bestMoveUci.slice(2, 4) as Key;
  return [{ orig, dest, brush: "bestmove" }];
});

function handleAfterMove(orig: Key, dest: Key) {
  if (requiresPawnPromotion(props.fen, orig, dest)) {
    pendingPromotion.value = { orig, dest };
    return;
  }
  emit("move", `${orig}${dest}`);
}

function selectPromotionPiece(roleChar: "q" | "r" | "b" | "n") {
  if (!pendingPromotion.value) return;
  const { orig, dest } = pendingPromotion.value;
  pendingPromotion.value = null;
  emit("move", `${orig}${dest}${roleChar}`);
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
      brushes: BRUSHES,
      autoShapes: autoShapes.value,
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
      brushes: BRUSHES,
      autoShapes: autoShapes.value,
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
    autoShapes,
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
