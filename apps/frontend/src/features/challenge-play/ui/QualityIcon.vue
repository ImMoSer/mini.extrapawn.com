<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    quality: string;
    size?: number;
    color?: string;
  }>(),
  {
    size: 14,
    color: "currentColor",
  }
);

const SYMBOLS: Record<string, string> = {
  brilliant: "!!",
  great: "!",
  best: "★",
  excellent: "✓",
  good: "✓",
  neutral: "ok",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
  missed_mate: "✕",
};

const symbol = computed(() => SYMBOLS[props.quality] || "");
</script>

<template>
  <span
    v-if="symbol"
    class="inline-flex items-center justify-center text-center leading-none font-extrabold not-italic select-none"
    :style="{ fontSize: `${size}px`, color }"
    aria-hidden="true"
  >
    {{ symbol }}
  </span>
</template>

