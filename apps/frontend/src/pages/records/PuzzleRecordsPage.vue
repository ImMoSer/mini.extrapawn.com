<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  ChallengeDiscipline,
  ChallengeParticipantDTO,
  ReplaySpeedMode,
} from "shared";
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

function canReplayParticipant(p: ChallengeParticipantDTO): boolean {
  const c = store.challenge;
  return Boolean(
    c &&
      store.isFinished &&
      c.discipline !== "tactics" &&
      p.solved &&
      p.uci_moves &&
      p.uci_moves.trim().length > 0
  );
}

function hasMoveTimings(p: ChallengeParticipantDTO): boolean {
  return Array.isArray(p.move_times_ms) && p.move_times_ms.length > 0;
}

function navigateToParticipantReplay(
  p: ChallengeParticipantDTO,
  speed: ReplaySpeedMode
) {
  const c = store.challenge;
  if (!c) return;
  void router.push(
    `/challenge/${c.discipline}/${encodeURIComponent(
      c.puzzle_id
    )}/${encodeURIComponent(c.edition)}/${encodeURIComponent(
      c.chat_id
    )}/${encodeURIComponent(p.telegram_id)}?speed=${speed}`
  );
}

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
          {{ t("records_puzzle_prefix") }} #{{ store.challenge.puzzle_id }} • {{ store.challenge.club_title }}
        </h1>
      </div>

      <button
        type="button"
        class="truncate rounded-lg bg-brand px-3.5 py-2 text-xs font-bold text-on-brand transition hover:bg-brand-deep"
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
        {{ t("records_open_board_btn") }}
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
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="w-6 shrink-0 font-condensed font-bold text-text-secondary">
              #{{ p.rank }}
            </span>
            <span class="min-w-0 truncate font-bold text-text-primary">
              {{ p.display_name }}
            </span>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <span
              class="rounded px-2 py-0.5 font-condensed font-bold"
              :class="
                p.solved
                  ? 'bg-success/15 text-success'
                  : p.status === 'surrendered'
                    ? 'bg-danger/15 text-danger'
                    : 'bg-warning/15 text-warning'
              "
            >
              {{ p.score_text }}
              <template v-if="p.solved"> (+{{ p.points }} PTS)</template>
            </span>

            <span
              v-if="p.solved && p.solved_time_ms !== null"
              class="w-12 text-right font-condensed text-text-secondary"
            >
              {{ (Math.round((p.solved_time_ms / 1000) * 10) / 10).toFixed(1) }}s
            </span>

            <div
              v-if="canReplayParticipant(p)"
              class="flex items-center gap-1"
            >
              <button
                v-if="hasMoveTimings(p)"
                type="button"
                class="min-w-0 truncate rounded border border-brand/40 bg-elevated px-2 py-0.5 text-[11px] font-bold text-brand transition hover:border-brand"
                @click="navigateToParticipantReplay(p, 'game')"
              >
                {{ t("challenge_replay_game") }}
              </button>

              <button
                type="button"
                class="min-w-0 truncate rounded border border-brand/40 bg-elevated px-2 py-0.5 text-[11px] font-bold text-brand transition hover:border-brand"
                @click="navigateToParticipantReplay(p, 'fast')"
              >
                {{ t("challenge_replay_fast") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
