<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { type ChallengeDiscipline } from "shared";
import { useChallengeSessionStore } from "@/features/challenge-play/model/challengeSession.store";
import { useI18n } from "@/shared/i18n/useI18n";

const route = useRoute();
const router = useRouter();
const store = useChallengeSessionStore();
const { t, disciplineTitle, difficultyTitle } = useI18n();

const routeParams = computed(() => {
  const discipline = (route.params.discipline ||
    "tactics") as ChallengeDiscipline;
  const puzzleId = String(route.params.puzzleId || "");
  const edition = route.params.edition ? String(route.params.edition) : "1";
  const chatId = String(route.params.chatId || "");
  return { discipline, puzzleId, edition, chatId };
});

onMounted(() => {
  void store.loadChallenge(routeParams.value);
});
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-3 px-3 py-4">
    <section
      v-if="store.challenge"
      class="glass flex flex-wrap items-center justify-between gap-3 p-4"
    >
      <div>
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold text-brand uppercase">
            {{ disciplineTitle(store.challenge.discipline) }}
          </span>
          <span class="rounded border border-border bg-elevated px-2 py-0.5 text-xs text-text-secondary">
            {{ difficultyTitle(store.challenge.difficulty) }}
          </span>
        </div>
        <h1 class="mt-1 text-base font-bold text-text-primary">
          Задача #{{ store.challenge.puzzle_id }} • {{ store.challenge.club_title }}
        </h1>
      </div>

      <button
        type="button"
        class="rounded-lg bg-brand px-3.5 py-2 text-xs font-bold text-on-brand transition hover:bg-brand-deep"
        @click="
          router.push(
            `/challenge/${store.challenge.discipline}/${encodeURIComponent(
              store.challenge.puzzle_id
            )}/${encodeURIComponent(
              store.challenge.edition
            )}/${encodeURIComponent(store.challenge.chat_id)}`
          )
        "
      >
        ♟ Открыть доску
      </button>
    </section>

    <section v-if="store.challenge" class="glass flex flex-col gap-2 p-4">
      <h2 class="text-xs font-bold tracking-wider text-text-secondary uppercase">
        {{ t("challenge_leaderboard_title") }}
      </h2>

      <div class="flex flex-col divide-y divide-border">
        <div
          v-for="p in store.challenge.leaderboard"
          :key="p.telegram_id"
          class="flex items-center justify-between gap-2 py-2.5 text-xs"
        >
          <div class="flex items-center gap-2.5">
            <span class="w-6 font-condensed font-bold text-text-secondary">
              #{{ p.rank }}
            </span>
            <span class="font-bold text-text-primary">
              {{ p.display_name }}
            </span>
          </div>

          <div class="flex items-center gap-2.5">
            <span
              class="rounded px-2 py-0.5 font-condensed font-bold"
              :class="
                p.solved
                  ? 'bg-success/15 text-success'
                  : 'bg-warning/15 text-warning'
              "
            >
              {{ p.score_text }}
              <template v-if="p.solved"> (+{{ p.points }} PTS)</template>
            </span>

            <span
              v-if="p.solved && p.solved_time_ms !== null"
              class="w-14 text-right font-condensed text-text-secondary"
            >
              {{ (Math.round((p.solved_time_ms / 1000) * 10) / 10).toFixed(1) }}s
            </span>

            <button
              v-if="store.isFinished && p.solved && p.uci_moves"
              type="button"
              class="rounded border border-brand/40 bg-elevated px-2.5 py-1 text-[11px] font-bold text-brand hover:border-brand"
              @click="
                router.push(
                  `/challenge/${store.challenge.discipline}/${encodeURIComponent(
                    store.challenge.puzzle_id
                  )}/${encodeURIComponent(
                    store.challenge.edition
                  )}/${encodeURIComponent(
                    store.challenge.chat_id
                  )}/${encodeURIComponent(p.telegram_id)}`
                )
              "
            >
              {{ t("challenge_replay_moves") }}
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

