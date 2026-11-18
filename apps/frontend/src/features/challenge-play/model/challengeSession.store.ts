import type { Key } from "@lichess-org/chessground/types";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  ChallengeDiscipline,
  ChallengeParticipantDTO,
  ChallengeStateDTO,
  ReplaySpeedMode,
} from "shared";
import { useBoardStore } from "@/entities/chess";
import {
  analyzeFenPosition,
  applyMoveToFen,
  isThreefoldRepetition,
  type AppliedMoveResult,
} from "@/entities/chess/lib/chessPosition";
import { apiRequest } from "@/shared/api/httpClient";
import { playAppliedMoveSound, playChessSound } from "@/shared/lib/sound";
import { triggerHapticNotification } from "@/shared/lib/telegram";
import {
  BOT_NORMALIZED_MOVE_TIME_MS,
  createChallengeEngineFlow,
  parseChallengeBoardRoot,
  type EvaluatedMoveResult,
} from "./challengeEngineFlow";
import { useChallengeTimeline } from "./useChallengeTimeline";

export const useChallengeSessionStore = defineStore("challengeSession", () => {
  const boardStore = useBoardStore();
  const challenge = ref<ChallengeStateDTO | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const currentFen = ref<string>(
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
  );
  const boardRevision = ref(0);
  const lastMove = ref<[Key, Key] | undefined>(undefined);
  const solvedTacticalMoves = ref<string[]>([]);

  const playedUciMoves = ref<string[]>([]);
  const playedSanMoves = ref<string[]>([]);
  const playedMoveTimesMs = ref<number[]>([]);

  const coachRootFen = ref<string>(
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
  );
  const coachPrefixMoves = ref<string[]>([]);

  const isBotThinking = ref(false);
  const feedbackBanner = ref<{
    type: "error" | "success" | "info";
    messageKey: string;
  } | null>(null);

  const elapsedMs = ref(0);
  let timerHandle: ReturnType<typeof setInterval> | null = null;
  let timerStartedAt = 0;
  let turnStartedAt = Date.now();

  const analysisMode = ref<"none" | "stockfish" | "coach">("none");

  const timeline = useChallengeTimeline({
    boardStore,
    currentFen,
    lastMove,
    getChallenge: () => challenge.value,
  });

  const positionSnapshot = computed(() => analyzeFenPosition(currentFen.value));

  const isFinished = computed(() => {
    const status = challenge.value?.my_entry?.status;
    return status === "solved" || status === "surrendered";
  });

  const isWasmAnalysisEnabled = computed(
    () => isFinished.value && analysisMode.value === "stockfish"
  );

  const isCoachAnalysisEnabled = computed(
    () => isFinished.value && analysisMode.value === "coach"
  );

  const isBoardInteractive = computed(() => {
    if (isLoading.value || isBotThinking.value) return false;
    if (isFinished.value) return true;
    return positionSnapshot.value.turnColor === challenge.value?.user_color;
  });

  const canReset = computed(
    () =>
      Boolean(challenge.value) &&
      !isFinished.value &&
      !isLoading.value &&
      !isBotThinking.value &&
      playedUciMoves.value.length > 0
  );

  const coachPayloadContext = computed(() => {
    const stepMoves = timeline.timelineSteps.value
      .slice(1, timeline.timelineCursor.value + 1)
      .map((s) => s.uci)
      .filter(Boolean);
    return {
      startFen: coachRootFen.value,
      moves: [...coachPrefixMoves.value, ...stepMoves],
    };
  });

  function startTimer() {
    stopTimer();
    timerStartedAt = Date.now() - elapsedMs.value;
    turnStartedAt = Date.now();
    timerHandle = setInterval(() => {
      elapsedMs.value = Date.now() - timerStartedAt;
    }, 100);
  }

  function stopTimer() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
    timeline.stopAutoPlay();
  }

  function setupBoardFromChallenge(
    state: ChallengeStateDTO,
    options?: { skipSound?: boolean }
  ) {
    playedUciMoves.value = [];
    playedSanMoves.value = [];
    playedMoveTimesMs.value = [];
    turnStartedAt = Date.now();

    const parsedRoot = parseChallengeBoardRoot(state);
    solvedTacticalMoves.value = parsedRoot.solvedTacticalMoves;
    lastMove.value = parsedRoot.initialLastMove;
    coachRootFen.value = parsedRoot.coachRootFen;
    coachPrefixMoves.value = parsedRoot.coachPrefixMoves;

    boardStore.setupPosition(state.puzzle_fen, state.user_color, {
      skipSound: options?.skipSound,
    });
    const canonicalRootFen = boardStore.fen;
    currentFen.value = canonicalRootFen;
    boardStore.syncVisualCues({
      lastMove: parsedRoot.initialLastMove,
      lastNag: null,
      shapes: [],
    });

    timeline.resetTimelineRoot(canonicalRootFen, parsedRoot.initialLastMove);
    boardRevision.value += 1;
  }

  function restoreOwnSolvedTimelineIfAvailable(state: ChallengeStateDTO) {
    if (state.my_entry?.status !== "solved") return;
    const parsedRoot = parseChallengeBoardRoot(state);
    solvedTacticalMoves.value = parsedRoot.solvedTacticalMoves;

    if (state.my_entry.uci_moves) {
      timeline.loadMovesIntoTimeline(
        state.my_entry.uci_moves,
        state.my_entry.move_times_ms,
        null,
        true
      );
      return;
    }
    if (state.discipline === "tactics" && solvedTacticalMoves.value.length > 0) {
      timeline.loadMovesIntoTimeline(
        solvedTacticalMoves.value.join(" "),
        null,
        null,
        true
      );
    }
  }

  function restoreActiveDraftIfAvailable(state: ChallengeStateDTO): boolean {
    const entry = state.my_entry;
    if (entry?.status !== "in_progress" || !entry.uci_moves) {
      return false;
    }
    const tokens = entry.uci_moves.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return false;
    }

    for (let i = 0; i < tokens.length; i += 1) {
      const uci = tokens[i];
      if (!uci) break;
      const applied = applyMoveToFen(currentFen.value, uci);
      const delayMs = entry.move_times_ms?.[i] ?? BOT_NORMALIZED_MOVE_TIME_MS;
      currentFen.value = applied.nextFen;
      lastMove.value = [applied.from, applied.to];
      playedUciMoves.value.push(applied.uci);
      playedSanMoves.value.push(applied.san);
      playedMoveTimesMs.value.push(delayMs);
      timeline.appendMoveToTimeline(applied, { delayMs });
    }

    boardStore.loadPosition(currentFen.value, { skipSound: true });
    boardStore.syncVisualCues({
      lastMove: lastMove.value,
      lastNag: null,
      shapes: [],
    });
    turnStartedAt = Date.now();
    boardRevision.value += 1;
    return true;
  }

  function commitAppliedMove(
    applied: AppliedMoveResult,
    plyDurationMs: number
  ): EvaluatedMoveResult {
    currentFen.value = applied.nextFen;
    lastMove.value = [applied.from, applied.to];
    boardStore.applyUciMove(applied.uci, { skipSound: true });
    playedUciMoves.value.push(applied.uci);
    playedSanMoves.value.push(applied.san);
    playedMoveTimesMs.value.push(plyDurationMs);
    timeline.appendMoveToTimeline(applied, { delayMs: plyDurationMs });
    turnStartedAt = Date.now();

    const repetition = isThreefoldRepetition(
      timeline.timelineSteps.value.map((step) => step.fen),
      applied.nextFen
    );

    return {
      ...applied,
      isThreefoldRepetition: repetition,
      isDraw: applied.isDraw || repetition,
    };
  }

  function rollbackOptimisticMove() {
    if (!challenge.value) return;
    const prevUci = playedUciMoves.value.slice(0, -1);
    const prevTimes = playedMoveTimesMs.value.slice(0, -1);
    setupBoardFromChallenge(challenge.value, { skipSound: true });
    for (let i = 0; i < prevUci.length; i += 1) {
      const uci = prevUci[i];
      if (!uci) break;
      const applied = applyMoveToFen(currentFen.value, uci);
      const delay = prevTimes[i] ?? BOT_NORMALIZED_MOVE_TIME_MS;
      currentFen.value = applied.nextFen;
      lastMove.value = [applied.from, applied.to];
      playedUciMoves.value.push(applied.uci);
      playedSanMoves.value.push(applied.san);
      playedMoveTimesMs.value.push(delay);
      timeline.appendMoveToTimeline(applied, { delayMs: delay });
    }
    boardStore.loadPosition(currentFen.value, { skipSound: true });
    boardStore.syncVisualCues({
      lastMove: lastMove.value,
      lastNag: null,
      shapes: [],
    });
    boardRevision.value += 1;
  }

  function onSolvedFromServer(state: ChallengeStateDTO) {
    stopTimer();
    challenge.value = state;
    const parsedRoot = parseChallengeBoardRoot(state);
    solvedTacticalMoves.value = parsedRoot.solvedTacticalMoves;
    elapsedMs.value = state.my_entry?.solved_time_ms ?? elapsedMs.value;
    playChessSound("victory_applause");
    triggerHapticNotification("success");
    feedbackBanner.value = {
      type: "success",
      messageKey: "challenge_solved_banner",
    };
  }

  function onFailedAttemptFromServer(state: ChallengeStateDTO) {
    stopTimer();
    isBotThinking.value = false;
    challenge.value = state;
    playChessSound("tactics_error");
    triggerHapticNotification("error");
    feedbackBanner.value = {
      type: "error",
      messageKey: "challenge_wrong_move",
    };
    setupBoardFromChallenge(state, { skipSound: true });
    elapsedMs.value = state.my_entry?.elapsed_ms ?? 0;
    startTimer();
  }

  const engineFlow = createChallengeEngineFlow({
    challenge,
    currentFen,
    boardRevision,
    isBotThinking,
    error,
    getTurnStartedAt: () => turnStartedAt,
    isFinished: () => isFinished.value,
    commitAppliedMove,
    rollbackOptimisticMove,
    onSolvedFromServer,
    onFailedAttemptFromServer,
  });

  async function loadChallenge(params: {
    discipline: ChallengeDiscipline;
    puzzleId: string;
    edition: string;
    chatId: string;
  }): Promise<void> {
    isLoading.value = true;
    error.value = null;
    feedbackBanner.value = null;
    analysisMode.value = "none";
    stopTimer();

    try {
      const safeEdition = params.edition || "0";
      const res = await apiRequest<ChallengeStateDTO>(
        `/challenges/${encodeURIComponent(params.discipline)}/${encodeURIComponent(
          params.puzzleId
        )}/${encodeURIComponent(safeEdition)}/${encodeURIComponent(params.chatId)}`
      );

      challenge.value = res;
      setupBoardFromChallenge(res);

      if (res.my_entry?.status === "solved") {
        elapsedMs.value = res.my_entry.solved_time_ms ?? 0;
        feedbackBanner.value = {
          type: "success",
          messageKey: "challenge_solved_banner",
        };
        restoreOwnSolvedTimelineIfAvailable(res);
      } else if (res.my_entry?.status === "surrendered") {
        elapsedMs.value = 0;
        feedbackBanner.value = {
          type: "info",
          messageKey: "challenge_surrendered_banner",
        };
      } else {
        const resumed = restoreActiveDraftIfAvailable(res);
        if (resumed) {
          feedbackBanner.value = {
            type: "info",
            messageKey: "challenge_resumed_banner",
          };
        }
        elapsedMs.value = res.my_entry?.elapsed_ms ?? 0;
        startTimer();
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      isLoading.value = false;
    }
  }

  async function handleUserMove(
    uciMove: string,
    options?: { wasDragged?: boolean }
  ): Promise<void> {
    if (!challenge.value) return;

    if (isFinished.value) {
      try {
        const applied = applyMoveToFen(currentFen.value, uciMove);
        currentFen.value = applied.nextFen;
        lastMove.value = [applied.from, applied.to];
        boardStore.applyUciMove(applied.uci, { skipSound: true });
        timeline.appendMoveToTimeline(applied, { clearReplayTag: true });
        const repetition = isThreefoldRepetition(
          timeline.timelineSteps.value.map((step) => step.fen),
          applied.nextFen
        );
        playAppliedMoveSound({
          ...applied,
          isThreefoldRepetition: repetition,
        });
      } catch {
        boardStore.loadPosition(currentFen.value, { skipSound: true });
        boardStore.syncVisualCues({ lastMove: lastMove.value });
        boardRevision.value += 1;
      }
      return;
    }

    error.value = null;
    feedbackBanner.value = null;
    await engineFlow.executeActiveSolvingMove(uciMove, options);
  }

  async function resetChallengeAttempt(): Promise<void> {
    if (!canReset.value || !challenge.value) return;
    stopTimer();
    error.value = null;
    isBotThinking.value = true;
    boardRevision.value += 1;

    const c = challenge.value;
    try {
      const updated = await apiRequest<ChallengeStateDTO>(
        `/challenges/${encodeURIComponent(c.discipline)}/${encodeURIComponent(
          c.puzzle_id
        )}/${encodeURIComponent(c.edition)}/${encodeURIComponent(
          c.chat_id
        )}/reset`,
        { method: "POST" }
      );
      isBotThinking.value = false;
      onFailedAttemptFromServer(updated);
    } catch (err) {
      isBotThinking.value = false;
      error.value = err instanceof Error ? err.message : String(err);
      startTimer();
      console.error("[ChallengeSession] reset failed:", err);
    }
  }

  async function surrenderChallenge(): Promise<void> {
    if (!challenge.value || isFinished.value) return;
    stopTimer();
    error.value = null;
    isBotThinking.value = false;
    boardRevision.value += 1;
    playChessSound("nevergiveup");
    triggerHapticNotification("warning");
    const c = challenge.value;
    try {
      const updated = await apiRequest<ChallengeStateDTO>(
        `/challenges/${encodeURIComponent(c.discipline)}/${encodeURIComponent(
          c.puzzle_id
        )}/${encodeURIComponent(c.edition)}/${encodeURIComponent(
          c.chat_id
        )}/surrender`,
        { method: "POST" }
      );
      challenge.value = updated;
      const parsedRoot = parseChallengeBoardRoot(updated);
      solvedTacticalMoves.value = parsedRoot.solvedTacticalMoves;
      analysisMode.value = "coach";
      feedbackBanner.value = {
        type: "info",
        messageKey: "challenge_surrendered_banner",
      };
    } catch (err) {
      console.error("[ChallengeSession] surrender failed:", err);
    }
  }

  function startParticipantReplay(
    participant: ChallengeParticipantDTO,
    speed: ReplaySpeedMode = "fast"
  ): void {
    timeline.startParticipantReplay(participant, speed);
  }

  function exitParticipantReplay(): void {
    if (!challenge.value) return;
    setupBoardFromChallenge(challenge.value, { skipSound: true });
    restoreOwnSolvedTimelineIfAvailable(challenge.value);
    playChessSound("chpock");
  }

  function setAnalysisMode(mode: "none" | "stockfish" | "coach"): void {
    if (!isFinished.value) return;
    analysisMode.value = analysisMode.value === mode ? "none" : mode;
  }

  return {
    challenge,
    isLoading,
    error,
    currentFen,
    boardRevision,
    lastMove,
    playedUciMoves,
    playedSanMoves,
    timelineSteps: timeline.timelineSteps,
    timelineCursor: timeline.timelineCursor,
    canStepPrev: timeline.canStepPrev,
    canStepNext: timeline.canStepNext,
    coachPayloadContext,
    isBotThinking,
    feedbackBanner,
    elapsedMs,
    replayParticipant: timeline.replayParticipant,
    autoPlaySpeed: timeline.autoPlaySpeed,
    isAutoPlaying: timeline.isAutoPlaying,
    analysisMode,
    isWasmAnalysisEnabled,
    isCoachAnalysisEnabled,
    positionSnapshot,
    isFinished,
    isReplayActive: timeline.isReplayActive,
    isBoardInteractive,
    canReset,
    loadChallenge,
    handleUserMove,
    resetChallengeAttempt,
    surrenderChallenge,
    startParticipantReplay,
    setTimelineStep: timeline.setTimelineStep,
    goToFirstStep: timeline.goToFirstStep,
    stepBackward: timeline.stepBackward,
    stepForward: timeline.stepForward,
    goToLastStep: timeline.goToLastStep,
    exitParticipantReplay,
    setAnalysisMode,
    stopTimer,
  };
});
