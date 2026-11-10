<script setup lang="ts">
import type { Key } from "@lichess-org/chessground/types";
import { key2pos } from "@lichess-org/chessground/util";
import type { Role as ChessopsRole } from "chessops/types";
import { computed } from "vue";

interface Props {
  dest: Key;
  color: "white" | "black";
  orientation: "white" | "black";
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "piece-selected", role: ChessopsRole): void;
  (e: "cancel"): void;
}>();

const promotionRoles: ChessopsRole[] = ["queen", "knight", "rook", "bishop"];

const dialogPosition = computed(() => {
  const pos = key2pos(props.dest);
  let row = pos[1];
  let col = pos[0];

  if (props.orientation === "white") {
    row = 9 - row;
  } else {
    col = 9 - col;
  }

  return {
    gridColumnStart: col,
    gridRowStart: row,
  };
});

function getPiecePosition(index: number) {
  const baseRow = dialogPosition.value.gridRowStart;
  const isTopToBottom =
    (props.color === "white" && props.orientation === "white") ||
    (props.color === "black" && props.orientation === "black");
  return {
    gridColumnStart: dialogPosition.value.gridColumnStart,
    gridRowStart: isTopToBottom ? baseRow + index : baseRow - index,
  };
}

function selectPiece(role: ChessopsRole) {
  emit("piece-selected", role);
}
</script>

<template>
  <div
    class="cg-wrap !absolute !inset-0 z-30 !grid cursor-default touch-none grid-cols-8 grid-rows-8 bg-canvas/65"
    @click.self="emit('cancel')"
  >
    <div
      v-for="(role, index) in promotionRoles"
      :key="role"
      class="flex cursor-pointer items-center justify-center rounded-full bg-surface shadow-[0_0_12px_2px_rgba(0,0,0,0.6)] transition-all duration-150 hover:scale-105 hover:rounded-none hover:bg-warning"
      :style="getPiecePosition(index)"
      @click="selectPiece(role)"
    >
      <piece :class="`${color} ${role}`" class="h-full w-full bg-cover"></piece>
    </div>
  </div>
</template>
