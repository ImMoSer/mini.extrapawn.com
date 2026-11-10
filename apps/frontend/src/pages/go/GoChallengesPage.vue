<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { GoActiveChallengeItemDTO, GoActiveChallengesResponseDTO } from "shared";
import { apiRequest } from "@/shared/api/httpClient";
import { useI18n } from "@/shared/i18n/useI18n";

const router = useRouter();
const { t, disciplineTitle, difficultyTitle } = useI18n();

const challenges = ref<GoActiveChallengeItemDTO[]>([]);
const loading = ref(true);
const errorMessage = ref<string | null>(null);

async function loadGoFeed() {
  loading.value = true;
  errorMessage.value = null;
  try {
    const res = await apiRequest<GoActiveChallengesResponseDTO>(
      "/challenges/go-feed"
    );
    challenges.value = res.challenges;
  } catch (err) {
    errorMessage.value =
      err instanceof Error ? err.message : "Failed to load active challenges";
  } finally {
    loading.value = false;
  }
}

function formatBestTime(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

function openChallenge(item: GoActiveChallengeItemDTO) {
  void router.push(
    `/challenge/${item.discipline}/${encodeURIComponent(item.puzzle_id)}/${encodeURIComponent(item.edition)}/${encodeURIComponent(item.chat_id)}`
  );
}

onMounted(() => {
  void loadGoFeed();
});
</script>

<template>
  <main class="mx-auto flex w-full max-w-2xl flex-col gap-4 px-3 py-4">
    <!-- Header Banner -->
    <section class="panel-card flex items-center justify-between gap-3 p-4">
      <div>
        <div class="flex items-center gap-2">
          <span class="rounded bg-info px-2 py-0.5 text-[11px] font-black tracking-wider text-on-brand uppercase">
            GO
          </span>
          <h1 class="text-sm font-black tracking-wide text-text-primary uppercase">
            {{ t("go_title") }}
          </h1>
        </div>
        <p class="mt-1 text-xs text-text-secondary">
          {{ t("go_subtitle") }}
        </p>
      </div>
      <div
        v-if="!loading"
        class="flex h-8 min-w-8 items-center justify-center rounded-lg border border-info/40 bg-info/15 px-2.5 font-mono text-sm font-black text-info"
      >
        {{ challenges.length }}
      </div>
    </section>

    <div
      v-if="loading"
      class="panel-card p-6 text-center text-sm text-text-secondary"
    >
      Загрузка активных челленджей...
    </div>

    <div
      v-else-if="errorMessage"
      class="panel-card border-danger/50 p-4 text-sm text-danger"
    >
      {{ errorMessage }}
    </div>

    <div
      v-else-if="challenges.length === 0"
      class="panel-card p-6 text-center text-xs text-text-secondary"
    >
      {{ t("go_empty") }}
    </div>

    <section v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <button
        v-for="item in challenges"
        :key="`${item.chat_id}:${item.discipline}:${item.puzzle_id}:${item.edition}`"
        type="button"
        class="flex flex-col justify-between gap-2 rounded-lg border border-border bg-elevated px-3 py-2.5 text-left transition hover:border-info"
        @click="openChallenge(item)"
      >
        <div class="flex w-full items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="truncate rounded bg-surface px-1.5 py-0.5 text-[10px] font-bold text-info">
                🏆 {{ item.club_title }}
              </span>
              <span class="text-xs font-bold text-text-primary">
                {{ disciplineTitle(item.discipline) }}
              </span>
            </div>
            <div class="mt-0.5 text-[11px] text-text-secondary">
              {{ item.category || item.domain || "MIX" }} •
              {{ difficultyTitle(item.difficulty) }}
            </div>
          </div>
          <span class="shrink-0 text-xs font-black text-info">
            {{ t("go_solve_cta") }}
          </span>
        </div>

        <!-- Social Trigger Row -->
        <div
          v-if="item.solved_count > 0"
          class="flex items-center gap-2 border-t border-border/60 pt-1.5 text-[10px] text-text-secondary"
        >
          <span>
            👥 {{ t("records_social_solved") }}:
            <strong class="text-text-primary">{{ item.solved_count }}</strong>
          </span>
          <span v-if="item.best_time_ms !== null">
            • {{ t("records_social_best") }}:
            <strong class="font-mono text-brand">{{ formatBestTime(item.best_time_ms) }}</strong>
          </span>
        </div>
      </button>
    </section>
  </main>
</template>
