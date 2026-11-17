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
import {
  triggerHapticImpact,
  triggerHapticNotification,
} from "@/shared/lib/telegram";
import { useChallengeTimeline } from "./useChallengeTimeline";

const BOT_NORMALIZED_MOVE_TIME_MS = 250;
const MIN_USER_MOVE_TIME_MS = 100;
const MAX_USER_MOVE_TIME_MS = 10_000;

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
  const expectedSolutionMoves = ref<string[]>([]);
  const scenarioStepIndex = ref(0);

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
  const gaviotaHint = ref<string | null>(null);

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
    gaviotaHint.value = null;
    turnStartedAt = Date.now();

    const rawSolution = (state.tactical_solution || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    currentFen.value = state.puzzle_fen;

    let initialLastMove: [Key, Key] | undefined = undefined;
    let resolvedRootFen = state.puzzle_fen;
    let resolvedPrefixMoves: string[] = [];

    if (state.first_move === "bot" && rawSolution[0]) {
      const m0 = rawSolution[0];
      initialLastMove = [m0.slice(0, 2) as Key, m0.slice(2, 4) as Key];
      expectedSolutionMoves.value = rawSolution.slice(1);

      if (state.initial_fen && state.initial_fen !== state.puzzle_fen) {
        try {
          const checkSetup = applyMoveToFen(state.initial_fen, m0);
          if (
            checkSetup.nextFen.split(" ")[0] === state.puzzle_fen.split(" ")[0]
          ) {
            resolvedRootFen = state.initial_fen;
            resolvedPrefixMoves = [checkSetup.uci];
          }
        } catch {
          resolvedRootFen = state.puzzle_fen;
          resolvedPrefixMoves = [];
        }
      }
    } else {
      expectedSolutionMoves.value = rawSolution;
    }

    lastMove.value = initialLastMove;
    coachRootFen.value = resolvedRootFen;
    coachPrefixMoves.value = resolvedPrefixMoves;

    boardStore.setupPosition(state.puzzle_fen, state.user_color, {
      skipSound: options?.skipSound,
    });
    const canonicalRootFen = boardStore.fen;
    currentFen.value = canonicalRootFen;
    boardStore.syncVisualCues({
      lastMove: initialLastMove,
      lastNag: null,
      shapes: [],
    });

    timeline.resetTimelineRoot(canonicalRootFen, initialLastMove);
    scenarioStepIndex.value = 0;
    boardRevision.value += 1;
  }

  function restoreOwnSolvedTimelineIfAvailable(state: ChallengeStateDTO) {
    if (state.my_entry?.status !== "solved") return;
    if (state.my_entry.uci_moves) {
      timeline.loadMovesIntoTimeline(
        state.my_entry.uci_moves,
        state.my_entry.move_times_ms,
        null,
        true
      );
      return;
    }
    if (state.discipline === "tactics" && expectedSolutionMoves.value.length > 0) {
      timeline.loadMovesIntoTimeline(
        expectedSolutionMoves.value.join(" "),
        null,
        null,
        true
      );
    }
  }

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
        elapsedMs.value = 0;
        startTimer();
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      isLoading.value = false;
    }
  }

  async function submitAttemptToBackend(solved: boolean): Promise<void> {
    if (!challenge.value) return;
    const c = challenge.value;
    const includeHistory = solved && c.discipline !== "tactics";
    try {
      const updated = await apiRequest<ChallengeStateDTO>(
        `/challenges/${encodeURIComponent(c.discipline)}/${encodeURIComponent(
          c.puzzle_id
        )}/${encodeURIComponent(c.edition)}/${encodeURIComponent(
          c.chat_id
        )}/attempt`,
        {
          method: "POST",
          body: JSON.stringify({
            solved,
            time_ms: elapsedMs.value,
            uci_moves: solved ? playedUciMoves.value.join(" ") : "",
            pgn_moves: includeHistory ? playedSanMoves.value.join(" ") : "",
            move_times_ms: includeHistory ? playedMoveTimesMs.value : undefined,
          }),
        }
      );
      challenge.value = updated;
    } catch (err) {
      console.error("[ChallengeSession] submitAttempt failed:", err);
    }
  }

  async function completeSolvedChallenge(): Promise<void> {
    stopTimer();
    playChessSound("victory_applause");
    triggerHapticNotification("success");
    feedbackBanner.value = {
      type: "success",
      messageKey: "challenge_solved_banner",
    };
    await submitAttemptToBackend(true);
  }

  async function recordFailedAttempt(resetToStart: boolean): Promise<void> {
    stopTimer();
    error.value = null;
    isBotThinking.value = false;
    playChessSound("tactics_error");
    triggerHapticNotification("error");
    feedbackBanner.value = {
      type: "error",
      messageKey: "challenge_wrong_move",
    };
    if (resetToStart && challenge.value) {
      setupBoardFromChallenge(challenge.value, { skipSound: true });
    } else {
      boardStore.loadPosition(currentFen.value, { skipSound: true });
      boardStore.syncVisualCues({ lastMove: lastMove.value, lastNag: null });
      boardRevision.value += 1;
    }
    await submitAttemptToBackend(false);
    elapsedMs.value = 0;
    startTimer();
  }

  async function checkGaviotaIfFewPieces(fen: string): Promise<void> {
    const snap = analyzeFenPosition(fen);
    if (snap.piecesCount > 5) {
      gaviotaHint.value = null;
      return;
    }
    try {
      const res = await apiRequest<{
        candidates?: { uci: string; outcome?: string; dtm?: number }[];
      }>("/engine/gaviota", {
        method: "POST",
        body: JSON.stringify({
          fen,
          max_candidates: 3,
          include_pv: false,
        }),
      });
      const top = res?.candidates?.[0];
      if (top) {
        gaviotaHint.value = `Gaviota TB: ${top.uci} (${top.outcome ?? "TB"}${
          top.dtm !== undefined ? ` DTM ${top.dtm}` : ""
        })`;
      }
    } catch {
      // Ignore if TableService is unreachable
    }
  }

  type EvaluatedMoveResult = AppliedMoveResult & {
    isThreefoldRepetition: boolean;
  };

  function commitAppliedMove(
    applied: AppliedMoveResult,
    actor: "user" | "bot"
  ): EvaluatedMoveResult {
    const now = Date.now();
    const plyDurationMs =
      actor === "user"
        ? Math.min(
            MAX_USER_MOVE_TIME_MS,
            Math.max(MIN_USER_MOVE_TIME_MS, now - turnStartedAt)
          )
        : BOT_NORMALIZED_MOVE_TIME_MS;

    currentFen.value = applied.nextFen;
    lastMove.value = [applied.from, applied.to];
    boardStore.applyUciMove(applied.uci, { skipSound: true });
    playedUciMoves.value.push(applied.uci);
    playedSanMoves.value.push(applied.san);
    playedMoveTimesMs.value.push(plyDurationMs);
    timeline.appendMoveToTimeline(applied, { delayMs: plyDurationMs });

    // Reset turn clock right when the move lands on board so user thinking time excludes bot roundtrip
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

  async function handleTerminalMoveOutcome(
    evaluated: EvaluatedMoveResult,
    actor: "user" | "bot"
  ): Promise<boolean> {
    if (!challenge.value) return false;

    if (evaluated.isCheckmate) {
      if (actor === "user") {
        await completeSolvedChallenge();
      } else {
        await recordFailedAttempt(true);
      }
      return true;
    }

    if (evaluated.isDraw) {
      if (challenge.value.objective === "hold_draw") {
        await completeSolvedChallenge();
      } else {
        await recordFailedAttempt(true);
      }
      return true;
    }

    return false;
  }

  async function requestBotSparringMove(): Promise<void> {
    if (!challenge.value) return;
    const revisionAtRequest = boardRevision.value;
    isBotThinking.value = true;
    error.value = null;
    try {
      const res = await apiRequest<{ bestMove: string | null }>(
        "/engine/bestmove",
        {
          method: "POST",
          body: JSON.stringify({
            engine: challenge.value.bot_engine,
            start_fen: challenge.value.puzzle_fen,
            moves: playedUciMoves.value,
          }),
        }
      );

      if (
        boardRevision.value !== revisionAtRequest ||
        !challenge.value ||
        isFinished.value
      ) {
        return;
      }

      if (!res.bestMove) {
        throw new Error(
          "[ChallengeSession] Engine returned empty bestMove for non-terminal position."
        );
      }

      const evaluated = commitAppliedMove(
        applyMoveToFen(currentFen.value, res.bestMove),
        "bot"
      );
      playAppliedMoveSound(evaluated);

      void checkGaviotaIfFewPieces(currentFen.value);

      await handleTerminalMoveOutcome(evaluated, "bot");
    } catch (err) {
      if (boardRevision.value !== revisionAtRequest) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      error.value = message;
      console.error("[ChallengeSession] Bot move failed:", err);
    } finally {
      if (boardRevision.value === revisionAtRequest) {
        isBotThinking.value = false;
      }
    }
  }

  async function handleUserMove(uciMove: string): Promise<void> {
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

    const expectedUci = expectedSolutionMoves.value[scenarioStepIndex.value];
    if (expectedUci) {
      const preview = applyMoveToFen(currentFen.value, uciMove);

      const isMatch =
        uciMove === expectedUci ||
        (uciMove.slice(0, 4) === expectedUci.slice(0, 4) &&
          uciMove.length === 5 &&
          expectedUci.length === 4) ||
        preview.isCheckmate;

      if (!isMatch) {
        await recordFailedAttempt(true);
        return;
      }

      const evaluated = commitAppliedMove(preview, "user");
      scenarioStepIndex.value += 1;
      triggerHapticImpact("light");
      playAppliedMoveSound(evaluated);

      if (await handleTerminalMoveOutcome(evaluated, "user")) {
        return;
      }

      if (
        scenarioStepIndex.value >= expectedSolutionMoves.value.length &&
        challenge.value.strategy === "scenarioOnly"
      ) {
        await completeSolvedChallenge();
        return;
      }

      const botUci = expectedSolutionMoves.value[scenarioStepIndex.value];
      if (botUci) {
        const revisionAtDelay = boardRevision.value;
        isBotThinking.value = true;
        let botEvaluated: EvaluatedMoveResult | null = null;
        try {
          await new Promise((r) => setTimeout(r, BOT_NORMALIZED_MOVE_TIME_MS));
          if (
            boardRevision.value !== revisionAtDelay ||
            !challenge.value ||
            isFinished.value
          ) {
            return;
          }
          botEvaluated = commitAppliedMove(
            applyMoveToFen(currentFen.value, botUci),
            "bot"
          );
          scenarioStepIndex.value += 1;
        } finally {
          if (boardRevision.value === revisionAtDelay) {
            isBotThinking.value = false;
          }
        }
        if (!botEvaluated) {
          return;
        }
        playAppliedMoveSound(botEvaluated);

        if (await handleTerminalMoveOutcome(botEvaluated, "bot")) {
          return;
        }
      }

      if (
        scenarioStepIndex.value >= expectedSolutionMoves.value.length &&
        challenge.value.strategy === "scenarioPlus" &&
        positionSnapshot.value.turnColor !== challenge.value.user_color
      ) {
        await requestBotSparringMove();
      }
      return;
    }

    const evaluated = commitAppliedMove(
      applyMoveToFen(currentFen.value, uciMove),
      "user"
    );
    triggerHapticImpact("light");
    playAppliedMoveSound(evaluated);

    if (await handleTerminalMoveOutcome(evaluated, "user")) {
      return;
    }

    await requestBotSparringMove();
  }

  async function resetChallengeAttempt(): Promise<void> {
    if (!canReset.value) return;
    await recordFailedAttempt(true);
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
    gaviotaHint,
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
