<script setup lang="ts">
import type { Dests, Key, MoveMetadata } from "@lichess-org/chessground/types";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  type ChallengeDiscipline,
  type ChallengeParticipantDTO,
  type ReplaySpeedMode,
} from "shared";
import { useBoardStore, WebChessBoard } from "@/entities/chess";
import { useChallengeSessionStore } from "@/features/challenge-play/model/challengeSession.store";
import { useCoachAnalysis } from "@/features/challenge-play/model/useCoachAnalysis";
import ChallengeControlToolbar from "@/features/challenge-play/ui/ChallengeControlToolbar.vue";
import ChallengeLeaderboardCard from "@/features/challenge-play/ui/ChallengeLeaderboardCard.vue";
import CompactCoachPanel from "@/features/challenge-play/ui/CompactCoachPanel.vue";
import StockfishAnalysisCard from "@/features/challenge-play/ui/StockfishAnalysisCard.vue";
import { useI18n } from "@/shared/i18n/useI18n";
import {
  buildLocalAnalysisShapes,
  classifyLocalEngineLines,
  type ClassifiedEngineLine,
} from "@/shared/lib/analysis/localAnalysisVisuals";
import type { CoachDrawShape } from "@/shared/lib/coach/visualizer";
import { useStockfishWasm } from "@/shared/lib/stockfishWasm";

const route = useRoute();
const router = useRouter();
const boardStore = useBoardStore();
const store = useChallengeSessionStore();
const coach = useCoachAnalysis();
const { t, disciplineTitle, difficultyTitle, focusTitle } = useI18n();
const wasm = useStockfishWasm();

const selectedSfMultipv = ref<number | null>(null);

const routeParams = computed(() => {
  const discipline = (route.params.discipline ||
    "tactics") as ChallengeDiscipline;
  const puzzleId = String(route.params.puzzleId || "");
  const rawEdition = route.params.edition ? String(route.params.edition) : "1";
  const rawChatId = String(route.params.chatId || "");
  const targetUserId = route.params.userId
    ? String(route.params.userId)
    : undefined;
  const requestedSpeed: ReplaySpeedMode =
    route.query.speed === "game" ? "game" : "fast";

  return {
    discipline,
    puzzleId,
    edition: rawEdition,
    chatId: rawChatId,
    targetUserId,
    requestedSpeed,
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

const isAnalysisActive = computed(
  () => store.isWasmAnalysisEnabled || store.isCoachAnalysisEnabled
);

const classifiedSfLines = computed<ClassifiedEngineLine[]>(() => {
  if (!store.isFinished || !store.isWasmAnalysisEnabled || !store.currentFen) {
    return [];
  }
  const lines = wasm.state.value.lines;
  if (lines.length === 0) return [];
  return classifyLocalEngineLines(
    store.currentFen,
    lines.map((line) => ({
      id: line.multipv,
      depth: line.depth,
      moverScore:
        line.moverMate !== null
          ? { type: "mate", value: line.moverMate }
          : { type: "cp", value: line.moverCp ?? 0 },
      wdl: line.wdl,
      pvUci: line.pvUci,
    }))
  );
});

const activeBoardShapes = computed<CoachDrawShape[]>(() => {
  if (!store.isFinished) return [];

  if (store.isWasmAnalysisEnabled) {
    return buildLocalAnalysisShapes(classifiedSfLines.value, {
      highlightedLineId: selectedSfMultipv.value,
    });
  }

  if (store.isCoachAnalysisEnabled) {
    return coach.drawableShapes.value;
  }

  return [];
});

const EMPTY_DESTS: Dests = new Map();

const activeDests = computed<Dests>(() => {
  void store.boardRevision;
  return store.isBoardInteractive ? boardStore.dests : EMPTY_DESTS;
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
  metadata,
}: {
  orig: Key;
  dest: Key;
  metadata: MoveMetadata;
}): Promise<void> {
  const uci = await boardStore.prepareUserUciMove({ orig, dest });
  if (!uci) {
    boardStore.loadPosition(store.currentFen, { skipSound: true });
    boardStore.syncVisualCues({ lastMove: store.lastMove });
    return;
  }
  const wasDragged = typeof metadata?.holdTime === "number";
  await store.handleUserMove(uci, { wasDragged });
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

function handleReplayClick(
  participant: ChallengeParticipantDTO,
  speed: ReplaySpeedMode
) {
  if (!store.isFinished || !participant.uci_moves) return;
  const effectiveSpeed: ReplaySpeedMode =
    speed === "game" &&
    Array.isArray(participant.move_times_ms) &&
    participant.move_times_ms.length > 0
      ? "game"
      : "fast";
  store.startParticipantReplay(participant, effectiveSpeed);
}

function openClubRecords() {
  if (!store.challenge) return;
  void router.push(
    `/challenge/records/${encodeURIComponent(store.challenge.chat_id)}`
  );
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

function applyDeepLinkReplayOrAntiSpoiler() {
  const { discipline, puzzleId, edition, chatId, targetUserId, requestedSpeed } =
    routeParams.value;

  // Anti-Spoiler: if viewer has not yet solved or surrendered, treat 100% identically to clicking "ЗАТАЩИТЬ"
  if (!store.isFinished) {
    if (targetUserId || route.query.speed !== undefined) {
      void router.replace(
        `/challenge/${discipline}/${encodeURIComponent(
          puzzleId
        )}/${encodeURIComponent(edition)}/${encodeURIComponent(chatId)}`
      );
    }
    return;
  }

  if (targetUserId && store.challenge && store.challenge.discipline !== "tactics") {
    const target = store.challenge.leaderboard.find(
      (p) => p.telegram_id === targetUserId && p.uci_moves
    );
    if (target) {
      handleReplayClick(target, requestedSpeed);
    }
  }
}

async function loadFromCurrentRoute() {
  wasm.stopAnalysis();
  coach.resetCoach();
  selectedSfMultipv.value = null;

  await store.loadChallenge({
    discipline: routeParams.value.discipline,
    puzzleId: routeParams.value.puzzleId,
    edition: routeParams.value.edition,
    chatId: routeParams.value.chatId,
  });

  applyDeepLinkReplayOrAntiSpoiler();
}

watch(
  [() => store.analysisMode, () => store.currentFen],
  ([mode, fen]) => {
    if (!store.isFinished || !fen) {
      wasm.stopAnalysis();
      return;
    }

    if (mode === "stockfish") {
      selectedSfMultipv.value = null;
      wasm.analyzeFen(fen);
    } else {
      wasm.stopAnalysis();
    }

    if (mode === "coach" && store.challenge) {
      const ctx = store.coachPayloadContext;
      void coach.analyzePosition({
        discipline: store.challenge.discipline,
        puzzleId: store.challenge.puzzle_id,
        edition: store.challenge.edition,
        chatId: store.challenge.chat_id,
        startFen: ctx.startFen,
        moves: ctx.moves,
      });
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
        :animation-duration="130"
        :can-edit="true"
        @user-move="handleBoardUserMove"
        @complete-promotion="boardStore.completePromotion"
        @shapes-change="boardStore.setDrawableShapes"
        @wheel-navigate="handleWheelNavigate"
      />
    </div>

    <!-- Single-Row Control Bar Directly Under Board -->
    <ChallengeControlToolbar
      v-if="store.challenge"
      :is-finished="store.isFinished"
      :can-reset="store.canReset"
      :is-wasm-analysis-enabled="store.isWasmAnalysisEnabled"
      :is-coach-analysis-enabled="store.isCoachAnalysisEnabled"
      :can-step-prev="store.canStepPrev"
      :can-step-next="store.canStepNext"
      @reset="store.resetChallengeAttempt()"
      @surrender="store.surrenderChallenge()"
      @open-records="openClubRecords"
      @switch-analysis="switchAnalysisTab"
      @first-step="store.goToFirstStep()"
      @prev-step="store.stepBackward()"
      @next-step="store.stepForward()"
      @last-step="store.goToLastStep()"
    />

    <!-- Resumed Active Attempt Notice (below toolbar so board never shifts vertically) -->
    <div
      v-if="store.feedbackBanner?.messageKey === 'challenge_resumed_banner'"
      class="rounded-md border border-brand/30 bg-elevated px-3 py-1.5 text-center text-xs font-semibold text-brand"
    >
      {{ t("challenge_resumed_banner") }}
    </div>

    <!-- Stockfish MultiPV = 3 Panel -->
    <StockfishAnalysisCard
      v-if="store.isWasmAnalysisEnabled"
      :wasm-state="wasm.state.value"
      :classified-lines="classifiedSfLines"
      :current-fen="store.currentFen"
      :selected-multipv="selectedSfMultipv"
      @select-multipv="
        (mpv) => (selectedSfMultipv = selectedSfMultipv === mpv ? null : mpv)
      "
    />

    <!-- Compact Coach Panel -->
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

    <!-- Multi-Row Wrapped PGN Strip (Shown ONLY when Stockfish or Coach analysis is active) -->
    <div
      v-if="isAnalysisActive && store.timelineSteps.length > 1"
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
    <ChallengeLeaderboardCard
      v-if="store.challenge"
      :leaderboard="store.challenge.leaderboard"
      :discipline="store.challenge.discipline"
      :is-finished="store.isFinished"
      :replay-participant="store.replayParticipant"
      :auto-play-speed="store.autoPlaySpeed"
      :is-auto-playing="store.isAutoPlaying"
      @replay="handleReplayClick"
      @exit-replay="store.exitParticipantReplay()"
    />
  </div>
</template>
