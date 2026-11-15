import type { Key } from "@lichess-org/chessground/types";
import { computed, ref, type Ref } from "vue";
import type {
  ChallengeParticipantDTO,
  ChallengeStateDTO,
  ReplaySpeedMode,
} from "shared";
import type { useBoardStore } from "@/entities/chess";
import {
  buildReplayTimeline,
  isThreefoldRepetition,
  type AppliedMoveResult,
  type ReplayStepSnapshot,
} from "@/entities/chess/lib/chessPosition";
import { playAppliedMoveSound, playChessSound } from "@/shared/lib/sound";

const FAST_REPLAY_DELAY_MS = 500;
const BOT_NORMALIZED_DELAY_MS = 250;
const MIN_USER_REPLAY_DELAY_MS = 100;
const MAX_USER_REPLAY_DELAY_MS = 10_000;

export function useChallengeTimeline(deps: {
  boardStore: ReturnType<typeof useBoardStore>;
  currentFen: Ref<string>;
  lastMove: Ref<[Key, Key] | undefined>;
  getChallenge: () => ChallengeStateDTO | null;
}) {
  const timelineSteps = ref<ReplayStepSnapshot[]>([]);
  const timelineCursor = ref(0);
  const replayParticipant = ref<ChallengeParticipantDTO | null>(null);
  const autoPlaySpeed = ref<ReplaySpeedMode | null>(null);

  let autoPlayTimer: ReturnType<typeof setTimeout> | null = null;

  const isReplayActive = computed(() => Boolean(replayParticipant.value));
  const isAutoPlaying = computed(() => autoPlaySpeed.value !== null);

  const canStepPrev = computed(() => timelineCursor.value > 0);
  const canStepNext = computed(
    () => timelineCursor.value < timelineSteps.value.length - 1
  );

  function stopAutoPlay(): void {
    if (autoPlayTimer !== null) {
      clearTimeout(autoPlayTimer);
      autoPlayTimer = null;
    }
    autoPlaySpeed.value = null;
  }

  function resetTimelineRoot(
    canonicalRootFen: string,
    initialLastMove: [Key, Key] | undefined
  ): void {
    stopAutoPlay();
    replayParticipant.value = null;
    timelineSteps.value = [
      {
        stepIndex: 0,
        fen: canonicalRootFen,
        uci: "",
        san: "",
        lastMove: initialLastMove,
      },
    ];
    timelineCursor.value = 0;
  }

  function appendMoveToTimeline(
    applied: AppliedMoveResult,
    options?: { delayMs?: number; clearReplayTag?: boolean }
  ): void {
    stopAutoPlay();
    const truncated = timelineSteps.value.slice(0, timelineCursor.value + 1);
    truncated.push({
      stepIndex: truncated.length,
      fen: applied.nextFen,
      uci: applied.uci,
      san: applied.san,
      lastMove: [applied.from, applied.to],
      delayMs: options?.delayMs,
      appliedMove: applied,
    });
    timelineSteps.value = truncated;
    timelineCursor.value = truncated.length - 1;
    if (options?.clearReplayTag && replayParticipant.value) {
      replayParticipant.value = null;
    }
  }

  function applyTimelineStepInternal(
    index: number,
    options: {
      withChpockSound: boolean;
      withAppliedMoveSound: boolean;
    }
  ): void {
    if (!timelineSteps.value.length) return;
    const clamped = Math.max(
      0,
      Math.min(timelineSteps.value.length - 1, index)
    );
    const prevIndex = timelineCursor.value;
    timelineCursor.value = clamped;
    const snap = timelineSteps.value[clamped];
    if (!snap) return;

    deps.currentFen.value = snap.fen;
    deps.lastMove.value = snap.lastMove;
    deps.boardStore.loadPosition(snap.fen, { skipSound: true });
    deps.boardStore.syncVisualCues({
      lastMove: snap.lastMove,
      lastNag: null,
      shapes: [],
    });

    if (clamped === prevIndex) return;

    if (options.withAppliedMoveSound && snap.appliedMove) {
      const fenHistoryUpToHere = timelineSteps.value
        .slice(0, clamped + 1)
        .map((s) => s.fen);
      const repetition = isThreefoldRepetition(fenHistoryUpToHere, snap.fen);
      playAppliedMoveSound({
        ...snap.appliedMove,
        isThreefoldRepetition: repetition,
      });
    } else if (options.withChpockSound) {
      playChessSound("chpock");
    }
  }

  function setTimelineStep(index: number, withSound: boolean = true): void {
    stopAutoPlay();
    applyTimelineStepInternal(index, {
      withChpockSound: withSound,
      withAppliedMoveSound: false,
    });
  }

  function loadMovesIntoTimeline(
    uciMoves: string,
    moveTimesMs: readonly number[] | null | undefined,
    participant: ChallengeParticipantDTO | null,
    jumpToEnd: boolean = true
  ): void {
    const c = deps.getChallenge();
    if (!c) return;
    stopAutoPlay();

    const initialStep = timelineSteps.value[0];
    const built = buildReplayTimeline(c.puzzle_fen, uciMoves, moveTimesMs);
    if (built[0] && initialStep?.lastMove) {
      built[0].lastMove = initialStep.lastMove;
    }
    replayParticipant.value = participant;
    timelineSteps.value = built;
    const targetIdx = jumpToEnd ? built.length - 1 : 0;
    applyTimelineStepInternal(targetIdx, {
      withChpockSound: false,
      withAppliedMoveSound: false,
    });
  }

  function resolveStepAutoDelayMs(
    step: ReplayStepSnapshot,
    speed: ReplaySpeedMode
  ): number {
    if (speed === "fast") {
      return FAST_REPLAY_DELAY_MS;
    }
    // `stepIndex` 1, 3, 5... are user moves; `stepIndex` 2, 4, 6... are bot replies
    const isBotPly = step.stepIndex % 2 === 0;
    if (isBotPly) {
      return BOT_NORMALIZED_DELAY_MS;
    }
    const raw = step.delayMs ?? FAST_REPLAY_DELAY_MS;
    return Math.min(
      MAX_USER_REPLAY_DELAY_MS,
      Math.max(MIN_USER_REPLAY_DELAY_MS, Math.round(raw))
    );
  }

  function scheduleNextAutoStep(): void {
    const speed = autoPlaySpeed.value;
    if (!speed) return;

    const nextIdx = timelineCursor.value + 1;
    const nextStep = timelineSteps.value[nextIdx];
    if (!nextStep) {
      autoPlaySpeed.value = null;
      autoPlayTimer = null;
      return;
    }

    const waitMs = resolveStepAutoDelayMs(nextStep, speed);
    autoPlayTimer = setTimeout(() => {
      if (autoPlaySpeed.value !== speed) return;
      applyTimelineStepInternal(nextIdx, {
        withChpockSound: false,
        withAppliedMoveSound: true,
      });
      scheduleNextAutoStep();
    }, waitMs);
  }

  function startParticipantReplay(
    participant: ChallengeParticipantDTO,
    speed: ReplaySpeedMode = "fast"
  ): void {
    const c = deps.getChallenge();
    if (!c || !participant.uci_moves) return;

    // Clicking the same active button pauses auto-play cleanly
    if (
      replayParticipant.value?.telegram_id === participant.telegram_id &&
      autoPlaySpeed.value === speed
    ) {
      stopAutoPlay();
      return;
    }

    const effectiveSpeed: ReplaySpeedMode =
      speed === "game" &&
      Array.isArray(participant.move_times_ms) &&
      participant.move_times_ms.length > 0
        ? "game"
        : "fast";

    loadMovesIntoTimeline(
      participant.uci_moves,
      participant.move_times_ms,
      participant,
      false
    );

    if (timelineSteps.value.length <= 1) return;

    autoPlaySpeed.value = effectiveSpeed;
    scheduleNextAutoStep();
  }

  function goToFirstStep(): void {
    setTimelineStep(0);
  }

  function stepBackward(): void {
    setTimelineStep(timelineCursor.value - 1);
  }

  function stepForward(): void {
    setTimelineStep(timelineCursor.value + 1);
  }

  function goToLastStep(): void {
    setTimelineStep(timelineSteps.value.length - 1);
  }

  return {
    timelineSteps,
    timelineCursor,
    replayParticipant,
    autoPlaySpeed,
    isReplayActive,
    isAutoPlaying,
    canStepPrev,
    canStepNext,
    stopAutoPlay,
    resetTimelineRoot,
    appendMoveToTimeline,
    loadMovesIntoTimeline,
    startParticipantReplay,
    setTimelineStep,
    goToFirstStep,
    stepBackward,
    stepForward,
    goToLastStep,
  };
}
