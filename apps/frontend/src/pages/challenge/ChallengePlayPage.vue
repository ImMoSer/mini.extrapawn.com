<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  DEFAULT_CLUB_CHAT_ID,
  type ChallengeDiscipline,
  type ChallengeParticipantDTO,
} from "shared";
import MiniChessBoard from "@/entities/chess/ui/MiniChessBoard.vue";
import { useChallengeSessionStore } from "@/features/challenge-play/model/challengeSession.store";
import { useI18n, type TranslationKey } from "@/shared/i18n/useI18n";
import { useStockfishWasm } from "@/shared/lib/stockfishWasm";

const route = useRoute();
const router = useRouter();
const store = useChallengeSessionStore();
const { t, disciplineTitle, difficultyTitle } = useI18n();
const wasm = useStockfishWasm();

const routeParams = computed(() => {
  const discipline = (route.params.discipline ||
    "tactics") as ChallengeDiscipline;
  const puzzleId = String(route.params.puzzleId || "");
  const rawEdition = route.params.edition ? String(route.params.edition) : "1";
  const rawChatId = route.params.chatId
    ? String(route.params.chatId)
    : DEFAULT_CLUB_CHAT_ID;
  const targetUserId = route.params.userId
    ? String(route.params.userId)
    : undefined;

  return {
    discipline,
    puzzleId,
    edition: rawEdition,
    chatId: rawChatId,
    targetUserId,
  };
});

const formattedTimer = computed(() => {
  const sec = Math.round((store.elapsedMs / 1000) * 10) / 10;
  return `${sec.toFixed(1)}s`;
});

const goalLabel = computed(() => {
  const c = store.challenge;
  if (!c) return "";
  if (c.discipline === "tactics") return t("challenge_goal_tactics");
  if (c.objective === "hold_draw") return t("challenge_goal_draw");
  return t("challenge_goal_win");
});

const turnIndicatorText = computed(() => {
  if (store.isBotThinking) return t("challenge_bot_thinking");
  return store.challenge?.user_color === "black"
    ? t("challenge_your_turn_black")
    : t("challenge_your_turn_white");
});

function toggleWasmEngine() {
  if (!store.isFinished) return;
  store.isWasmAnalysisEnabled = !store.isWasmAnalysisEnabled;
  if (store.isWasmAnalysisEnabled) {
    wasm.analyzeFen(store.currentFen);
  } else {
    wasm.stopAnalysis();
  }
}

function handleReplayClick(participant: ChallengeParticipantDTO) {
  if (!store.isFinished || !participant.uci_moves) return;
  store.startParticipantReplay(participant);
}

function goToNextActiveChallenge() {
  const next = store.challenge?.next_active_challenge;
  if (!next) return;
  wasm.stopAnalysis();
  void router.push(
    `/challenge/${next.discipline}/${encodeURIComponent(
      next.puzzle_id
    )}/${encodeURIComponent(next.edition)}/${encodeURIComponent(next.chat_id)}`
  );
}

async function loadFromCurrentRoute() {
  wasm.stopAnalysis();
  await store.loadChallenge({
    discipline: routeParams.value.discipline,
    puzzleId: routeParams.value.puzzleId,
    edition: routeParams.value.edition,
    chatId: routeParams.value.chatId,
  });

  if (routeParams.value.targetUserId && store.isFinished && store.challenge) {
    const target = store.challenge.leaderboard.find(
      (p) => p.telegram_id === routeParams.value.targetUserId && p.uci_moves
    );
    if (target) {
      store.startParticipantReplay(target);
    }
  }
}

watch(
  () => store.currentFen,
  (fen) => {
    if (store.isWasmAnalysisEnabled && fen) {
      wasm.analyzeFen(fen);
    }
  }
);

watch(
  () =>
    `${routeParams.value.discipline}:${routeParams.value.puzzleId}:${routeParams.value.edition}:${routeParams.value.chatId}`,
  () => {
    void loadFromCurrentRoute();
  }
);

onMounted(() => {
  void loadFromCurrentRoute();
});

onUnmounted(() => {
  store.stopTimer();
  wasm.destroyWorker();
});
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-3 px-3 py-3">
    <!-- Challenge Top Info Bar -->
    <section
      v-if="store.challenge"
      class="glass flex flex-wrap items-center justify-between gap-2 p-3"
    >
      <div class="flex flex-col gap-0.5">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-xs font-bold tracking-wider text-brand uppercase">
            {{ disciplineTitle(store.challenge.discipline) }}
          </span>
          <span class="rounded border border-border bg-elevated px-1.5 py-0.5 text-[11px] font-bold text-text-secondary">
            {{ difficultyTitle(store.challenge.difficulty) }} •
            {{ store.challenge.bot_engine.toUpperCase() }}
          </span>
          <span class="rounded border border-border bg-elevated px-1.5 py-0.5 text-[11px] text-text-secondary">
            {{ store.challenge.category }}
          </span>
        </div>
        <span class="text-xs font-semibold text-text-primary">
          ⚔️ {{ goalLabel }} • {{ store.challenge.club_title }}
        </span>
      </div>

      <div class="flex items-center gap-2">
        <div class="rounded-md border border-border bg-elevated px-2.5 py-1 text-right">
          <div class="text-[10px] text-text-secondary uppercase">SCORE</div>
          <div class="font-condensed text-sm font-bold text-text-primary">
            {{ store.challenge.my_entry?.score_text || "0/0" }}
          </div>
        </div>
        <div class="rounded-md border border-border bg-elevated px-2.5 py-1 text-right">
          <div class="text-[10px] text-text-secondary uppercase">TIME</div>
          <div class="font-condensed text-sm font-bold text-brand">
            {{ formattedTimer }}
          </div>
        </div>
      </div>
    </section>

    <!-- Status / Feedback Banner -->
    <div
      v-if="store.feedbackBanner"
      class="rounded-lg border px-3 py-2 text-xs font-bold"
      :class="
        store.feedbackBanner.type === 'success'
          ? 'border-success/40 bg-success/15 text-success'
          : store.feedbackBanner.type === 'error'
            ? 'border-danger/40 bg-danger/15 text-danger'
            : 'border-info/40 bg-info/15 text-info'
      "
    >
      {{ t(store.feedbackBanner.messageKey as TranslationKey) }}
    </div>

    <div
      v-else-if="store.challenge && !store.isFinished"
      class="flex items-center justify-between rounded-lg border border-border bg-elevated px-3 py-2 text-xs font-semibold text-text-secondary"
    >
      <span>{{ turnIndicatorText }}</span>
      <span v-if="store.gaviotaHint" class="font-condensed text-info">
        {{ store.gaviotaHint }}
      </span>
    </div>

    <!-- WASM Stockfish Evaluation Bar (when active) -->
    <div
      v-if="store.isWasmAnalysisEnabled"
      class="glass flex flex-col gap-1.5 p-2.5"
    >
      <div class="flex items-center justify-between text-xs">
        <span class="font-bold text-highlight">
          <template v-if="wasm.state.value.error">
            ⚠️ {{ wasm.state.value.error }}
          </template>
          <template v-else-if="wasm.state.value.isLoading">
            ⏳ Stockfish 19 Lite (загрузка...)
          </template>
          <template v-else>
            Stockfish 19 Lite (d={{ wasm.state.value.depth }})
          </template>
        </span>
        <span class="font-condensed text-sm font-bold text-text-primary">
          {{ wasm.state.value.evalLabel }}
          <span
            v-if="wasm.state.value.bestMoveUci"
            class="ml-1 text-xs text-brand"
          >
            Best: {{ wasm.state.value.bestMoveUci }}
          </span>
        </span>
      </div>
      <div class="h-2 w-full overflow-hidden rounded-full bg-eval-black">
        <div
          class="h-full bg-eval-white transition-all duration-200"
          :style="{ width: `${wasm.state.value.evalWhitePercent}%` }"
        ></div>
      </div>
    </div>

    <!-- Interactive Chessboard -->
    <MiniChessBoard
      v-if="store.challenge"
      :fen="store.currentFen"
      :orientation="store.challenge.user_color"
      :turn-color="store.positionSnapshot.turnColor"
      :dests="store.positionSnapshot.dests"
      :last-move="store.lastMove"
      :check="store.positionSnapshot.isCheck"
      :interactive="store.isBoardInteractive"
      :best-move-uci="
        store.isWasmAnalysisEnabled ? wasm.state.value.bestMoveUci : null
      "
      @move="(uci) => store.handleUserMove(uci)"
    />

    <!-- Replay Controls Bar (when viewing a participant's solution) -->
    <section
      v-if="store.isReplayActive && store.replayParticipant"
      class="glass flex flex-col gap-2 p-3"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs font-bold text-brand">
          {{ t("challenge_replay_active") }}
          {{ store.replayParticipant.display_name }} ({{
            store.replayParticipant.score_text
          }})
        </span>
        <button
          type="button"
          class="rounded border border-border bg-elevated px-2.5 py-1 text-xs font-semibold text-text-primary hover:border-brand"
          @click="store.exitParticipantReplay()"
        >
          {{ t("challenge_exit_replay") }}
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-1.5 text-xs">
        <button
          v-for="step in store.replayTimeline.slice(1)"
          :key="step.stepIndex"
          type="button"
          class="rounded px-2 py-1 font-condensed font-bold transition"
          :class="
            store.replayStepIndex === step.stepIndex
              ? 'bg-brand text-on-brand'
              : 'bg-elevated text-text-secondary hover:text-text-primary'
          "
          @click="store.setReplayStep(step.stepIndex)"
        >
          {{ step.stepIndex }}. {{ step.san }}
        </button>
      </div>

      <div class="grid grid-cols-4 gap-2 pt-1">
        <button
          type="button"
          class="rounded-md border border-border bg-elevated py-1.5 text-xs font-bold text-text-primary"
          @click="store.setReplayStep(0)"
        >
          |&lt;&lt;
        </button>
        <button
          type="button"
          class="rounded-md border border-border bg-elevated py-1.5 text-xs font-bold text-text-primary"
          @click="store.setReplayStep(store.replayStepIndex - 1)"
        >
          &lt;
        </button>
        <button
          type="button"
          class="rounded-md border border-border bg-elevated py-1.5 text-xs font-bold text-text-primary"
          @click="store.setReplayStep(store.replayStepIndex + 1)"
        >
          &gt;
        </button>
        <button
          type="button"
          class="rounded-md border border-border bg-elevated py-1.5 text-xs font-bold text-text-primary"
          @click="store.setReplayStep(store.replayTimeline.length - 1)"
        >
          &gt;&gt;|
        </button>
      </div>
    </section>

    <!-- Bonus: Next Active Challenge Button -->
    <button
      v-if="
        store.challenge &&
        store.isFinished &&
        store.challenge.next_active_challenge
      "
      type="button"
      class="w-full rounded-lg bg-brand py-2.5 text-xs font-bold text-on-brand shadow-sm transition hover:bg-brand-deep"
      @click="goToNextActiveChallenge"
    >
      {{ t("challenge_next_active_btn") }} → ({{
        t("challenge_remaining_label")
      }}
      {{ store.challenge.remaining_active_count }})
    </button>

    <!-- Action Bar (Surrender / Local WASM Stockfish / Club Leaderboard) -->
    <section v-if="store.challenge" class="flex flex-wrap items-center gap-2">
      <button
        v-if="!store.isFinished"
        type="button"
        class="flex-1 rounded-lg border border-danger/40 bg-elevated px-3 py-2 text-xs font-bold text-danger transition hover:border-danger"
        @click="store.surrenderChallenge()"
      >
        🏳️ {{ t("challenge_surrender_btn") }}
      </button>

      <button
        v-if="store.isFinished"
        type="button"
        class="flex-1 rounded-lg border px-3 py-2 text-xs font-bold transition"
        :class="
          store.isWasmAnalysisEnabled
            ? 'border-highlight bg-highlight/20 text-highlight'
            : 'border-border bg-elevated text-text-primary hover:border-highlight'
        "
        @click="toggleWasmEngine"
      >
        🔬 {{ t("challenge_wasm_btn") }}
      </button>

      <button
        type="button"
        class="rounded-lg border border-border bg-elevated px-3 py-2 text-xs font-bold text-text-primary transition hover:border-brand hover:text-brand"
        @click="
          router.push(
            `/records/${store.challenge.discipline}/${encodeURIComponent(
              store.challenge.puzzle_id
            )}/${encodeURIComponent(
              store.challenge.edition
            )}/${encodeURIComponent(store.challenge.chat_id)}`
          )
        "
      >
        📋 Задача
      </button>

      <button
        type="button"
        class="rounded-lg border border-border bg-elevated px-3 py-2 text-xs font-bold text-brand transition hover:border-brand"
        @click="
          router.push(
            `/challenge/records/${encodeURIComponent(store.challenge.chat_id)}`
          )
        "
      >
        🏆 {{ t("cabinet_open_records") }}
      </button>
    </section>

    <!-- Per-Challenge Live Leaderboard -->
    <section v-if="store.challenge" class="glass flex flex-col gap-2 p-3.5">
      <div class="flex items-center justify-between">
        <h2 class="text-xs font-bold tracking-wider text-text-secondary uppercase">
          {{ t("challenge_leaderboard_title") }} ({{
            store.challenge.leaderboard.length
          }})
        </h2>
        <span
          v-if="!store.isFinished"
          class="text-[11px] text-text-secondary"
        >
          🔒 Ходы других игроков откроются после решения
        </span>
      </div>

      <div class="flex flex-col divide-y divide-border">
        <div
          v-for="p in store.challenge.leaderboard"
          :key="p.telegram_id"
          class="flex items-center justify-between gap-2 py-2 text-xs"
        >
          <div class="flex items-center gap-2">
            <span class="w-5 font-condensed font-bold text-text-secondary">
              #{{ p.rank }}
            </span>
            <span class="font-bold text-text-primary">
              {{ p.display_name }}
            </span>
          </div>

          <div class="flex items-center gap-2">
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

            <button
              v-if="store.isFinished && p.solved && p.uci_moves"
              type="button"
              class="rounded border border-brand/40 bg-elevated px-2 py-0.5 text-[11px] font-bold text-brand transition hover:border-brand"
              @click="handleReplayClick(p)"
            >
              {{ t("challenge_replay_moves") }}
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

