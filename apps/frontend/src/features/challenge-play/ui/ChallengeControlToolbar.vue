<script setup lang="ts">
import { useI18n } from "@/shared/i18n/useI18n";

defineProps<{
  isFinished: boolean;
  canReset: boolean;
  isWasmAnalysisEnabled: boolean;
  isCoachAnalysisEnabled: boolean;
  canStepPrev: boolean;
  canStepNext: boolean;
}>();

const emit = defineEmits<{
  reset: [];
  surrender: [];
  openRecords: [];
  switchAnalysis: [mode: "stockfish" | "coach"];
  firstStep: [];
  prevStep: [];
  nextStep: [];
  lastStep: [];
}>();

const { t } = useI18n();
</script>

<template>
  <section class="glass flex items-center justify-between gap-1.5 px-2 py-1.5">
    <!-- Active Solving Mode Controls -->
    <template v-if="!isFinished">
      <button
        type="button"
        :disabled="!canReset"
        class="min-w-0 flex-1 truncate rounded-md border border-warning/40 bg-elevated px-3 py-1.5 text-xs font-bold text-warning transition hover:border-warning disabled:cursor-not-allowed disabled:opacity-40"
        @click="emit('reset')"
      >
        ↺ {{ t("challenge_reset_btn") }}
      </button>

      <button
        type="button"
        class="min-w-0 flex-1 truncate rounded-md border border-danger/40 bg-elevated px-3 py-1.5 text-xs font-bold text-danger transition hover:border-danger"
        @click="emit('surrender')"
      >
        🏳️ {{ t("challenge_surrender_btn") }}
      </button>

      <button
        type="button"
        class="shrink-0 truncate rounded-md border border-border bg-elevated px-3 py-1.5 text-xs font-bold text-brand transition hover:border-brand"
        @click="emit('openRecords')"
      >
        🏆 {{ t("cabinet_open_records") }}
      </button>
    </template>

    <!-- Finished / Analysis Mode Single-Row Toolbar: [Stockfish] [Coach] | [SVG Nav] | [🏆 Рекорды] -->
    <template v-else>
      <div class="flex min-w-0 items-center gap-1">
        <button
          type="button"
          class="min-w-0 truncate rounded border px-2 py-1 text-[11px] font-bold tracking-tight uppercase transition"
          :class="
            isWasmAnalysisEnabled
              ? 'border-highlight bg-highlight/20 text-highlight'
              : 'border-border bg-elevated text-text-secondary hover:text-text-primary'
          "
          @click="emit('switchAnalysis', 'stockfish')"
        >
          {{ t("challenge_wasm_btn") }}
        </button>

        <button
          type="button"
          class="min-w-0 truncate rounded border px-2 py-1 text-[11px] font-bold tracking-tight uppercase transition"
          :class="
            isCoachAnalysisEnabled
              ? 'border-brand bg-brand/20 text-brand'
              : 'border-border bg-elevated text-text-secondary hover:text-text-primary'
          "
          @click="emit('switchAnalysis', 'coach')"
        >
          {{ t("challenge_coach_btn") }}
        </button>
      </div>

      <!-- Compact Single-Row Move Navigation (Ionicons 5 SVG icons) -->
      <div class="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-elevated p-0.5">
        <button
          type="button"
          class="flex h-6.5 w-7 items-center justify-center rounded-sm transition disabled:opacity-35"
          :class="
            canStepPrev
              ? 'text-text-secondary hover:bg-surface hover:text-text-primary'
              : 'text-text-disabled'
          "
          :disabled="!canStepPrev"
          aria-label="First move"
          @click="emit('firstStep')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="h-3.5 w-3.5">
            <path
              d="M400 111v290c0 17.44-17 28.52-31 20.16L121.09 272.79c-12.12-7.25-12.12-26.33 0-33.58L369 90.84c14-8.36 31 2.72 31 20.16z"
              fill="none"
              stroke="currentColor"
              stroke-miterlimit="10"
              stroke-width="36"
            />
            <path
              d="M112 80v352"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-miterlimit="10"
              stroke-width="36"
            />
          </svg>
        </button>
        <button
          type="button"
          class="flex h-6.5 w-7 items-center justify-center rounded-sm transition disabled:opacity-35"
          :class="
            canStepPrev
              ? 'text-text-secondary hover:bg-surface hover:text-text-primary'
              : 'text-text-disabled'
          "
          :disabled="!canStepPrev"
          aria-label="Previous move"
          @click="emit('prevStep')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="h-3.5 w-3.5">
            <path
              d="M328 112L184 256l144 144"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="48"
            />
          </svg>
        </button>
        <button
          type="button"
          class="flex h-6.5 w-7 items-center justify-center rounded-sm transition disabled:opacity-35"
          :class="
            canStepNext
              ? 'text-text-secondary hover:bg-surface hover:text-text-primary'
              : 'text-text-disabled'
          "
          :disabled="!canStepNext"
          aria-label="Next move"
          @click="emit('nextStep')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="h-3.5 w-3.5">
            <path
              d="M184 112l144 144-144 144"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="48"
            />
          </svg>
        </button>
        <button
          type="button"
          class="flex h-6.5 w-7 items-center justify-center rounded-sm transition disabled:opacity-35"
          :class="
            canStepNext
              ? 'text-text-secondary hover:bg-surface hover:text-text-primary'
              : 'text-text-disabled'
          "
          :disabled="!canStepNext"
          aria-label="Last move"
          @click="emit('lastStep')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="h-3.5 w-3.5">
            <path
              d="M112 111v290c0 17.44 17 28.52 31 20.16l247.9-148.37c12.12-7.25 12.12-26.33 0-33.58L143 90.84c-14-8.36-31 2.72-31 20.16z"
              fill="none"
              stroke="currentColor"
              stroke-miterlimit="10"
              stroke-width="36"
            />
            <path
              d="M400 80v352"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-miterlimit="10"
              stroke-width="36"
            />
          </svg>
        </button>
      </div>

      <button
        type="button"
        class="shrink-0 truncate rounded border border-border bg-elevated px-2 py-1 text-[11px] font-bold text-brand transition hover:border-brand"
        @click="emit('openRecords')"
      >
        🏆 {{ t("cabinet_open_records") }}
      </button>
    </template>
  </section>
</template>
