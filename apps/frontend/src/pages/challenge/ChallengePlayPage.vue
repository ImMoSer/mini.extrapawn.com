<script setup lang="ts">
import type { Dests, Key } from "@lichess-org/chessground/types";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  DEFAULT_CLUB_CHAT_ID,
  type ChallengeDiscipline,
  type ChallengeParticipantDTO,
} from "shared";
import { useBoardStore, WebChessBoard } from "@/entities/chess";
import { uciLineToSan } from "@/entities/chess/lib/chessPosition";
import { useChallengeSessionStore } from "@/features/challenge-play/model/challengeSession.store";
import { useCoachAnalysis } from "@/features/challenge-play/model/useCoachAnalysis";
import CompactCoachPanel from "@/features/challenge-play/ui/CompactCoachPanel.vue";
import { useI18n } from "@/shared/i18n/useI18n";
import type { CoachDrawShape } from "@/shared/lib/coach/visualizer";
import { useStockfishWasm } from "@/shared/lib/stockfishWasm";

const route = useRoute();
const router = useRouter();
const boardStore = useBoardStore();
const store = useChallengeSessionStore();
const coach = useCoachAnalysis();
const { t, disciplineTitle, difficultyTitle, focusTitle } = useI18n();
const wasm = useStockfishWasm();

const selectedSfMultipv = ref<number>(1);

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

const formattedSfLines = computed(() => {
  const fen = store.currentFen;
  return wasm.state.value.lines.map((line) => {
    const sanMoves = uciLineToSan(fen, line.pvUci);
    return {
      ...line,
      pvText: sanMoves.length > 0 ? sanMoves.join(" ") : line.pvUci.join(" "),
    };
  });
});

const activeBoardShapes = computed<CoachDrawShape[]>(() => {
  if (!store.isFinished) return [];

  if (store.isWasmAnalysisEnabled) {
    const chosen =
      wasm.state.value.lines.find(
        (l) => l.multipv === selectedSfMultipv.value
      ) ?? wasm.state.value.lines[0];

    const uci = chosen?.bestMoveUci ?? wasm.state.value.bestMoveUci;
    const brush = chosen?.arrowBrush ?? wasm.state.value.bestMoveBrush;
    if (!uci || uci.length < 4) return [];

    return [
      {
        orig: uci.slice(0, 2) as Key,
        dest: uci.slice(2, 4) as Key,
        brush,
        modifiers: { lineWidth: 10 },
      },
    ];
  }

  if (store.isCoachAnalysisEnabled) {
    return coach.drawableShapes.value;
  }

  return [];
});

const activeDests = computed<Dests>(() => {
  void store.boardRevision;
  return store.isBoardInteractive ? new Map(boardStore.dests) : new Map();
});

watch(
  activeBoardShapes,
  (shapes) => {
    boardStore.setCoachShapes(shapes);
  },
  { immediate: true }
);

async function handleBoardUserMove({
  orig,
  dest,
}: {
  orig: Key;
  dest: Key;
}): Promise<void> {
  const uci = await boardStore.prepareUserUciMove({ orig, dest });
  if (!uci) {
    boardStore.loadPosition(store.currentFen, { skipSound: true });
    boardStore.syncVisualCues({ lastMove: store.lastMove });
    return;
  }
  await store.handleUserMove(uci);
}

function handleWheelNavigate(direction: "up" | "down"): void {
  if (!store.isFinished) return;
  if (direction === "up" && store.canStepPrev) {
    store.stepBackward();
  } else if (direction === "down" && store.canStepNext) {
    store.stepForward();
  }
}

function switchAnalysisTab(mode: "stockfish" | "coach") {
  if (!store.isFinished) return;
  store.setAnalysisMode(mode);
}

function handleReplayClick(participant: ChallengeParticipantDTO) {
  if (!store.isFinished || !participant.uci_moves) return;
  store.startParticipantReplay(participant);
}

function goToNextActiveChallenge() {
  const next = store.challenge?.next_active_challenge;
  if (!next) return;
  wasm.stopAnalysis();
  coach.resetCoach();
  void router.push(
    `/challenge/${next.discipline}/${encodeURIComponent(
      next.puzzle_id
    )}/${encodeURIComponent(next.edition)}/${encodeURIComponent(next.chat_id)}`
  );
}

async function loadFromCurrentRoute() {
  wasm.stopAnalysis();
  coach.resetCoach();
  selectedSfMultipv.value = 1;

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
  [() => store.analysisMode, () => store.currentFen],
  ([mode, fen]) => {
    if (!store.isFinished || !fen) {
      wasm.stopAnalysis();
      return;
    }

    if (mode === "stockfish") {
      selectedSfMultipv.value = 1;
      wasm.analyzeFen(fen);
    } else {
      wasm.stopAnalysis();
    }

    if (mode === "coach") {
      const ctx = store.coachPayloadContext;
      void coach.analyzePosition(ctx.startFen, ctx.moves);
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
  coach.resetCoach();
});
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-2.5 px-3 py-2.5">
    <!-- Challenge Top Info Bar -->
    <section
      v-if="store.challenge"
      class="glass flex flex-wrap items-center justify-between gap-2 p-2.5"
    >
      <div class="flex flex-col gap-0.5">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-xs font-bold tracking-wider text-brand uppercase">
            {{ disciplineTitle(store.challenge.discipline) }}
          </span>
          <span class="rounded border border-border bg-elevated px-1.5 py-0.5 text-[11px] font-bold text-text-secondary">
            {{ difficultyTitle(store.challenge.difficulty) }}
            <template v-if="store.challenge.discipline !== 'tactics'">
              • {{ store.challenge.bot_engine.toUpperCase() }}
            </template>
          </span>
          <span class="rounded border border-border bg-elevated px-1.5 py-0.5 text-[11px] text-text-secondary">
            {{ focusTitle(store.challenge.discipline, store.challenge.category) }}
          </span>
        </div>
        <span class="text-xs font-semibold text-text-primary">
          ⚔️ {{ goalLabel }} • {{ store.challenge.club_title }}
        </span>
      </div>

      <div class="flex items-center gap-1.5">
        <div class="rounded-md border border-border bg-elevated px-2 py-1 text-right">
          <div class="text-[9px] text-text-secondary uppercase">SCORE</div>
          <div class="font-condensed text-sm font-bold text-text-primary">
            {{ store.challenge.my_entry?.score_text || "0/0" }}
          </div>
        </div>
        <div class="rounded-md border border-border bg-elevated px-2 py-1 text-right">
          <div class="text-[9px] text-text-secondary uppercase">TIME</div>
          <div class="font-condensed text-sm font-bold text-brand">
            {{ formattedTimer }}
          </div>
        </div>
      </div>
    </section>

    <!-- Fail-Fast Error Banner -->
    <div
      v-if="store.error"
      class="panel-card border-danger/50 px-3 py-2 text-xs font-medium text-danger"
    >
      ⚠️ {{ store.error }}
    </div>

    <!-- Interactive Chessboard (stable vertical position — never shifts!) -->
    <div
      v-if="store.challenge"
      class="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-surface select-none"
    >
      <WebChessBoard
        :fen="boardStore.fen"
        :orientation="boardStore.orientation"
        :turn-color="boardStore.turn"
        :dests="activeDests"
        :last-move="boardStore.lastMove"
        :check="boardStore.isCheck"
        :promotion-state="boardStore.promotionState"
        :drawable-shapes="boardStore.drawableShapes"
        :is-analysis-mode="store.isFinished"
        :animation-enabled="true"
        :animation-duration="200"
        :can-edit="true"
        @user-move="handleBoardUserMove"
        @complete-promotion="boardStore.completePromotion"
        @shapes-change="boardStore.setDrawableShapes"
        @wheel-navigate="handleWheelNavigate"
      />
    </div>

    <!-- Single-Row Control Bar Directly Under Board -->
    <section
      v-if="store.challenge"
      class="glass flex items-center justify-between gap-1.5 px-2 py-1.5"
    >
      <!-- Active Solving Mode Controls -->
      <template v-if="!store.isFinished">
        <button
          type="button"
          :disabled="!store.canReset"
          class="flex-1 rounded-md border border-warning/40 bg-elevated px-3 py-1.5 text-xs font-bold text-warning transition hover:border-warning disabled:cursor-not-allowed disabled:opacity-40"
          @click="store.resetChallengeAttempt()"
        >
          ↺ {{ t("challenge_reset_btn") }}
        </button>

        <button
          type="button"
          class="flex-1 rounded-md border border-danger/40 bg-elevated px-3 py-1.5 text-xs font-bold text-danger transition hover:border-danger"
          @click="store.surrenderChallenge()"
        >
          🏳️ {{ t("challenge_surrender_btn") }}
        </button>

        <button
          type="button"
          class="rounded-md border border-border bg-elevated px-3 py-1.5 text-xs font-bold text-brand transition hover:border-brand"
          @click="
            router.push(
              `/challenge/records/${encodeURIComponent(store.challenge.chat_id)}`
            )
          "
        >
          🏆 {{ t("cabinet_open_records") }}
        </button>
      </template>

      <!-- Finished / Analysis Mode Single-Row Toolbar: [Stockfish] [Coach] | [SVG Nav] | [🏆 Рекорды] -->
      <template v-else>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="rounded border px-2 py-1 text-[11px] font-bold tracking-tight uppercase transition"
            :class="
              store.isWasmAnalysisEnabled
                ? 'border-highlight bg-highlight/20 text-highlight'
                : 'border-border bg-elevated text-text-secondary hover:text-text-primary'
            "
            @click="switchAnalysisTab('stockfish')"
          >
            {{ t("challenge_wasm_btn") }}
          </button>

          <button
            type="button"
            class="rounded border px-2 py-1 text-[11px] font-bold tracking-tight uppercase transition"
            :class="
              store.isCoachAnalysisEnabled
                ? 'border-brand bg-brand/20 text-brand'
                : 'border-border bg-elevated text-text-secondary hover:text-text-primary'
            "
            @click="switchAnalysisTab('coach')"
          >
            {{ t("challenge_coach_btn") }}
          </button>
        </div>

        <!-- Compact Single-Row Move Navigation (Ionicons 5 SVG icons matching app_vue ControlCenter.vue) -->
        <div class="inline-flex items-center gap-0.5 rounded-md border border-border bg-elevated p-0.5">
          <button
            type="button"
            class="flex h-6.5 w-7 items-center justify-center rounded-sm transition disabled:opacity-35"
            :class="
              store.canStepPrev
                ? 'text-text-secondary hover:bg-surface hover:text-text-primary'
                : 'text-text-disabled'
            "
            :disabled="!store.canStepPrev"
            aria-label="First move"
            @click="store.goToFirstStep()"
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
              store.canStepPrev
                ? 'text-text-secondary hover:bg-surface hover:text-text-primary'
                : 'text-text-disabled'
            "
            :disabled="!store.canStepPrev"
            aria-label="Previous move"
            @click="store.stepBackward()"
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
              store.canStepNext
                ? 'text-text-secondary hover:bg-surface hover:text-text-primary'
                : 'text-text-disabled'
            "
            :disabled="!store.canStepNext"
            aria-label="Next move"
            @click="store.stepForward()"
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
              store.canStepNext
                ? 'text-text-secondary hover:bg-surface hover:text-text-primary'
                : 'text-text-disabled'
            "
            :disabled="!store.canStepNext"
            aria-label="Last move"
            @click="store.goToLastStep()"
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
          class="shrink-0 rounded border border-border bg-elevated px-2 py-1 text-[11px] font-bold text-brand transition hover:border-brand"
          @click="
            router.push(
              `/challenge/records/${encodeURIComponent(store.challenge.chat_id)}`
            )
          "
        >
          🏆 {{ t("cabinet_open_records") }}
        </button>
      </template>
    </section>

    <!-- Stockfish MultiPV = 3 Panel (Below Controls — Zero Board Shift!) -->
    <section
      v-if="store.isWasmAnalysisEnabled"
      class="glass flex flex-col gap-1.5 p-2.5"
    >
      <div class="flex items-center justify-between text-xs">
        <span class="font-bold text-highlight">
          <template v-if="wasm.state.value.error">
            ⚠️ {{ wasm.state.value.error }}
          </template>
          <template v-else-if="wasm.state.value.isLoading">
            ⏳ Stockfish 19 Lite...
          </template>
          <template v-else>
            Stockfish 19 Lite (d={{ wasm.state.value.depth }})
          </template>
        </span>
        <span class="font-condensed text-sm font-bold text-text-primary">
          {{ wasm.state.value.evalLabel }}
        </span>
      </div>

      <div class="h-1.5 w-full overflow-hidden rounded-full bg-eval-black">
        <div
          class="h-full bg-eval-white transition-all duration-200"
          :style="{ width: `${wasm.state.value.evalWhitePercent}%` }"
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
            selectedSfMultipv === line.multipv
              ? 'border-border-hover bg-elevated'
              : 'border-border/60 bg-surface hover:border-border-hover'
          "
          @click="selectedSfMultipv = line.multipv"
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

    <!-- Compact Coach Panel (Below Controls — 100% app_vue visual_commands compatible) -->
    <CompactCoachPanel
      v-if="store.isCoachAnalysisEnabled"
      :is-analyzing="coach.isAnalyzing.value"
      :error="coach.error.value"
      :side-to-move="coach.sideToMove.value"
      :phase="coach.phase.value"
      :material-delta="coach.materialDelta.value"
      :opening-name="coach.openingName.value"
      :last-move-analysis="coach.lastMoveAnalysis.value"
      :pos-explanation="coach.posExplanation.value"
      :top-moves="coach.topMoves.value"
      :selected-move-index="coach.selectedMoveIndex.value"
      :show-visuals="coach.showVisuals.value"
      @select-move="(idx) => coach.selectMove(idx)"
      @toggle-visuals="coach.toggleVisuals()"
    />

    <!-- Multi-Row Wrapped PGN / Replay Strip (Placed BELOW Stockfish & Coach windows!) -->
    <div
      v-if="store.isFinished && store.timelineSteps.length > 1"
      class="glass flex flex-wrap items-center gap-1.5 px-2.5 py-2 text-xs"
    >
      <template v-if="store.isReplayActive && store.replayParticipant">
        <span class="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-bold text-brand">
          ▶ {{ store.replayParticipant.display_name }}
        </span>
        <button
          type="button"
          class="rounded border border-border bg-elevated px-1.5 py-0.5 text-[10px] font-bold text-text-secondary hover:text-text-primary"
          @click="store.exitParticipantReplay()"
        >
          ✕
        </button>
      </template>

      <button
        v-for="step in store.timelineSteps.slice(1)"
        :key="step.stepIndex"
        type="button"
        class="rounded px-1.5 py-0.5 font-mono text-[11px] font-bold transition"
        :class="
          store.timelineCursor === step.stepIndex
            ? 'bg-brand text-on-brand'
            : 'bg-elevated text-text-secondary hover:text-text-primary'
        "
        @click="store.setTimelineStep(step.stepIndex)"
      >
        {{ step.stepIndex }}.{{ step.san }}
      </button>
    </div>

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

    <!-- Per-Challenge Live Leaderboard -->
    <section v-if="store.challenge" class="glass flex flex-col gap-2 p-3">
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
