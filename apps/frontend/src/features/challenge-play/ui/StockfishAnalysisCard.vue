<script setup lang="ts">
import { computed } from "vue";
import { uciLineToSan } from "@/entities/chess/lib/chessPosition";
import type { WasmAnalysisState } from "@/shared/lib/stockfishWasm";

const props = defineProps<{
  wasmState: WasmAnalysisState;
  currentFen: string;
  selectedMultipv: number;
}>();

const emit = defineEmits<{
  selectMultipv: [multipv: number];
}>();

const formattedSfLines = computed(() => {
  return props.wasmState.lines.map((line) => {
    const sanMoves = uciLineToSan(props.currentFen, line.pvUci);
    return {
      ...line,
      pvText: sanMoves.length > 0 ? sanMoves.join(" ") : line.pvUci.join(" "),
    };
  });
});
</script>

<template>
  <section class="glass flex flex-col gap-1.5 p-2.5">
    <div class="flex items-center justify-between text-xs">
      <span class="font-bold text-highlight">
        <template v-if="wasmState.error">
          ⚠️ {{ wasmState.error }}
        </template>
        <template v-else-if="wasmState.isLoading">
          ⏳ Stockfish 19 Lite...
        </template>
        <template v-else>
          Stockfish 19 Lite (d={{ wasmState.depth }})
        </template>
      </span>
      <span class="font-condensed text-sm font-bold text-text-primary">
        {{ wasmState.evalLabel }}
      </span>
    </div>

    <div class="h-1.5 w-full overflow-hidden rounded-full bg-eval-black">
      <div
        class="h-full bg-eval-white transition-all duration-200"
        :style="{ width: `${wasmState.evalWhitePercent}%` }"
      ></div>
    </div>

    <!-- 3 MultiPV Lines with Win/Draw/Loss Evaluation Colors -->
    <div v-if="formattedSfLines.length > 0" class="mt-0.5 flex flex-col gap-1">
      <button
        v-for="line in formattedSfLines"
        :key="line.multipv"
        type="button"
        class="flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-xs transition"
        :class="
          selectedMultipv === line.multipv
            ? 'border-border-hover bg-elevated'
            : 'border-border/60 bg-surface hover:border-border-hover'
        "
        @click="emit('selectMultipv', line.multipv)"
      >
        <span class="w-3 shrink-0 font-mono text-[10px] font-bold text-text-secondary">
          {{ line.multipv }}.
        </span>
        <span
          class="w-12 shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-[11px] font-bold"
          :class="
            line.arrowBrush === 'green'
              ? 'bg-success/15 text-success'
              : line.arrowBrush === 'red'
                ? 'bg-danger/15 text-danger'
                : 'bg-info/15 text-info'
          "
        >
          {{ line.evalLabel }}
        </span>
        <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-text-primary">
          {{ line.pvText }}
        </span>
      </button>
    </div>
  </section>
</template>
