import type { Key } from "@lichess-org/chessground/types";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  ChallengeDiscipline,
  ChallengeParticipantDTO,
  ChallengeStateDTO,
} from "shared";
import { useBoardStore } from "@/entities/chess";
import {
  analyzeFenPosition,
  applyMoveToFen,
  buildReplayTimeline,
  type AppliedMoveResult,
  type ReplayStepSnapshot,
} from "@/entities/chess/lib/chessPosition";
import { apiRequest } from "@/shared/api/httpClient";
import { playAppliedMoveSound, playChessSound } from "@/shared/lib/sound";
import {
  triggerHapticImpact,
  triggerHapticNotification,
} from "@/shared/lib/telegram";

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

  // Unified move timeline for post-game stepping (|< < > >|) and Coach context
  const timelineSteps = ref<ReplayStepSnapshot[]>([]);
  const timelineCursor = ref(0);
  const coachRootFen = ref<string>(
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
  );
  const coachPrefixMoves = ref<string[]>([]);

  const isBotThinking = ref(false);
  const feedbackBanner = ref<{
    type: "error" | "success" | "info";
    messageKey: string;
  } | null>(null);

  // Timer state
  const elapsedMs = ref(0);
  let timerHandle: ReturnType<typeof setInterval> | null = null;
  let timerStartedAt = 0;

  // Replay participant metadata (when viewing another solved participant's game)
  const replayParticipant = ref<ChallengeParticipantDTO | null>(null);

  // Analysis engine mode ("none" | "stockfish" | "coach") unlocked when isFinished
  const analysisMode = ref<"none" | "stockfish" | "coach">("none");
  const gaviotaHint = ref<string | null>(null);

  const positionSnapshot = computed(() => analyzeFenPosition(currentFen.value));

  const isFinished = computed(() => {
    const status = challenge.value?.my_entry?.status;
    return status === "solved" || status === "surrendered";
  });

  const isReplayActive = computed(() => Boolean(replayParticipant.value));

  const isWasmAnalysisEnabled = computed(
    () => isFinished.value && analysisMode.value === "stockfish"
  );

  const isCoachAnalysisEnabled = computed(
    () => isFinished.value && analysisMode.value === "coach"
  );

  const canStepPrev = computed(() => timelineCursor.value > 0);
  const canStepNext = computed(
    () => timelineCursor.value < timelineSteps.value.length - 1
  );

  const isBoardInteractive = computed(() => {
    if (isLoading.value || isBotThinking.value) return false;
    if (isFinished.value) return true;
    return positionSnapshot.value.turnColor === challenge.value?.user_color;
  });

  const coachPayloadContext = computed(() => {
    const stepMoves = timelineSteps.value
      .slice(1, timelineCursor.value + 1)
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
    timerHandle = setInterval(() => {
      elapsedMs.value = Date.now() - timerStartedAt;
    }, 100);
  }

  function stopTimer() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function appendMoveToTimeline(
    applied: AppliedMoveResult,
    clearReplayTag: boolean = false
  ) {
    const truncated = timelineSteps.value.slice(0, timelineCursor.value + 1);
    truncated.push({
      stepIndex: truncated.length,
      fen: applied.nextFen,
      uci: applied.uci,
      san: applied.san,
      lastMove: [applied.from, applied.to],
    });
    timelineSteps.value = truncated;
    timelineCursor.value = truncated.length - 1;
    if (clearReplayTag && replayParticipant.value) {
      replayParticipant.value = null;
    }
  }

  function setupBoardFromChallenge(
    state: ChallengeStateDTO,
    options?: { skipSound?: boolean }
  ) {
    replayParticipant.value = null;
    playedUciMoves.value = [];
    playedSanMoves.value = [];
    gaviotaHint.value = null;

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
          if (checkSetup.nextFen.split(" ")[0] === state.puzzle_fen.split(" ")[0]) {
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
    boardStore.syncVisualCues({
      lastMove: initialLastMove,
      lastNag: null,
      shapes: [],
    });

    timelineSteps.value = [
      {
        stepIndex: 0,
        fen: state.puzzle_fen,
        uci: "",
        san: "",
        lastMove: initialLastMove,
      },
    ];
    timelineCursor.value = 0;
    scenarioStepIndex.value = 0;
    boardRevision.value += 1;
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
        if (res.my_entry.uci_moves) {
          loadMovesIntoTimeline(res.my_entry.uci_moves, null);
        }
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
            uci_moves: playedUciMoves.value.join(" "),
            pgn_moves: playedSanMoves.value.join(" "),
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

  async function requestBotSparringMove(): Promise<void> {
    if (!challenge.value) return;
    isBotThinking.value = true;
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

      if (!res.bestMove) {
        return;
      }

      const applied = applyMoveToFen(currentFen.value, res.bestMove);
      currentFen.value = applied.nextFen;
      lastMove.value = [applied.from, applied.to];
      boardStore.applyUciMove(applied.uci, { skipSound: true });
      playedUciMoves.value.push(applied.uci);
      playedSanMoves.value.push(applied.san);
      appendMoveToTimeline(applied);

      playAppliedMoveSound(applied);

      void checkGaviotaIfFewPieces(currentFen.value);

      if (applied.isCheckmate) {
        await recordFailedAttempt(true);
        return;
      }

      if (applied.isDraw) {
        if (challenge.value.objective === "hold_draw") {
          await completeSolvedChallenge();
        } else {
          await recordFailedAttempt(true);
        }
      }
    } catch (err) {
      console.error("[ChallengeSession] Bot move failed:", err);
    } finally {
      isBotThinking.value = false;
    }
  }

  async function handleUserMove(uciMove: string): Promise<void> {
    if (!challenge.value) return;

    // Post-game free analysis mode: branch timeline from current cursor
    if (isFinished.value) {
      try {
        const applied = applyMoveToFen(currentFen.value, uciMove);
        currentFen.value = applied.nextFen;
        lastMove.value = [applied.from, applied.to];
        boardStore.applyUciMove(applied.uci, { skipSound: true });
        appendMoveToTimeline(applied, true);
        playAppliedMoveSound(applied);
      } catch {
        boardStore.loadPosition(currentFen.value, { skipSound: true });
        boardStore.syncVisualCues({ lastMove: lastMove.value });
        boardRevision.value += 1;
      }
      return;
    }

    feedbackBanner.value = null;

    // 1. Scripted scenario phase
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

      currentFen.value = preview.nextFen;
      lastMove.value = [preview.from, preview.to];
      boardStore.applyUciMove(preview.uci, { skipSound: true });
      playedUciMoves.value.push(preview.uci);
      playedSanMoves.value.push(preview.san);
      appendMoveToTimeline(preview);
      scenarioStepIndex.value += 1;
      triggerHapticImpact("light");
      playAppliedMoveSound(preview);

      if (
        preview.isCheckmate ||
        (scenarioStepIndex.value >= expectedSolutionMoves.value.length &&
          challenge.value.strategy === "scenarioOnly")
      ) {
        await completeSolvedChallenge();
        return;
      }

      const botUci = expectedSolutionMoves.value[scenarioStepIndex.value];
      if (botUci) {
        isBotThinking.value = true;
        await new Promise((r) => setTimeout(r, 260));
        const botApplied = applyMoveToFen(currentFen.value, botUci);
        currentFen.value = botApplied.nextFen;
        lastMove.value = [botApplied.from, botApplied.to];
        boardStore.applyUciMove(botApplied.uci, { skipSound: true });
        playedUciMoves.value.push(botApplied.uci);
        playedSanMoves.value.push(botApplied.san);
        appendMoveToTimeline(botApplied);
        scenarioStepIndex.value += 1;
        isBotThinking.value = false;
        playAppliedMoveSound(botApplied);
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

    // 2. PlayOut Sparring Phase (`playOutOnly` or post-scenario `scenarioPlus`)
    const applied = applyMoveToFen(currentFen.value, uciMove);
    currentFen.value = applied.nextFen;
    lastMove.value = [applied.from, applied.to];
    boardStore.applyUciMove(applied.uci, { skipSound: true });
    playedUciMoves.value.push(applied.uci);
    playedSanMoves.value.push(applied.san);
    appendMoveToTimeline(applied);
    triggerHapticImpact("light");
    playAppliedMoveSound(applied);

    if (applied.isCheckmate) {
      await completeSolvedChallenge();
      return;
    }

    if (applied.isDraw) {
      if (challenge.value.objective === "hold_draw") {
        await completeSolvedChallenge();
      } else {
        await recordFailedAttempt(true);
      }
      return;
    }

    await requestBotSparringMove();
  }

  async function surrenderChallenge(): Promise<void> {
    if (!challenge.value || isFinished.value) return;
    stopTimer();
    playChessSound("timer_times_up");
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

  function loadMovesIntoTimeline(
    uciMoves: string,
    participant: ChallengeParticipantDTO | null
  ) {
    if (!challenge.value) return;
    const initialStep = timelineSteps.value[0];
    const built = buildReplayTimeline(challenge.value.puzzle_fen, uciMoves);
    if (built[0] && initialStep?.lastMove) {
      built[0].lastMove = initialStep.lastMove;
    }
    replayParticipant.value = participant;
    timelineSteps.value = built;
    setTimelineStep(built.length - 1, false);
  }

  function startParticipantReplay(participant: ChallengeParticipantDTO): void {
    if (!challenge.value || !participant.uci_moves) return;
    loadMovesIntoTimeline(participant.uci_moves, participant);
    playChessSound("chpock");
  }

  function setTimelineStep(index: number, withSound: boolean = true): void {
    if (!timelineSteps.value.length) return;
    const clamped = Math.max(
      0,
      Math.min(timelineSteps.value.length - 1, index)
    );
    const prevIndex = timelineCursor.value;
    timelineCursor.value = clamped;
    const snap = timelineSteps.value[clamped];
    if (!snap) return;
    currentFen.value = snap.fen;
    lastMove.value = snap.lastMove;
    boardStore.loadPosition(snap.fen, { skipSound: true });
    boardStore.syncVisualCues({
      lastMove: snap.lastMove,
      lastNag: null,
      shapes: [],
    });
    if (withSound && clamped !== prevIndex) {
      playChessSound("chpock");
    }
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

  function exitParticipantReplay(): void {
    if (!challenge.value) return;
    setupBoardFromChallenge(challenge.value, { skipSound: true });
    if (
      challenge.value.my_entry?.status === "solved" &&
      challenge.value.my_entry.uci_moves
    ) {
      loadMovesIntoTimeline(challenge.value.my_entry.uci_moves, null);
    }
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
    timelineSteps,
    timelineCursor,
    canStepPrev,
    canStepNext,
    coachPayloadContext,
    isBotThinking,
    feedbackBanner,
    elapsedMs,
    replayParticipant,
    analysisMode,
    isWasmAnalysisEnabled,
    isCoachAnalysisEnabled,
    gaviotaHint,
    positionSnapshot,
    isFinished,
    isReplayActive,
    isBoardInteractive,
    loadChallenge,
    handleUserMove,
    surrenderChallenge,
    startParticipantReplay,
    setTimelineStep,
    goToFirstStep,
    stepBackward,
    stepForward,
    goToLastStep,
    exitParticipantReplay,
    setAnalysisMode,
    stopTimer,
  };
});
