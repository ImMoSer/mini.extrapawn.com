import type { Key } from "@lichess-org/chessground/types";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  ChallengeDiscipline,
  ChallengeParticipantDTO,
  ChallengeStateDTO,
} from "shared";
import {
  analyzeFenPosition,
  applyMoveToFen,
  buildReplayTimeline,
  type ReplayStepSnapshot,
} from "@/entities/chess/lib/chessPosition";
import { apiRequest } from "@/shared/api/httpClient";
import { playChessSound } from "@/shared/lib/sound";
import {
  triggerHapticImpact,
  triggerHapticNotification,
} from "@/shared/lib/telegram";

export const useChallengeSessionStore = defineStore("challengeSession", () => {
  const challenge = ref<ChallengeStateDTO | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const currentFen = ref<string>(
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
  );
  const lastMove = ref<[Key, Key] | undefined>(undefined);
  const expectedSolutionMoves = ref<string[]>([]);
  const scenarioStepIndex = ref(0);

  const playedUciMoves = ref<string[]>([]);
  const playedSanMoves = ref<string[]>([]);

  const isBotThinking = ref(false);
  const feedbackBanner = ref<{
    type: "error" | "success" | "info";
    messageKey: string;
  } | null>(null);

  // Timer state
  const elapsedMs = ref(0);
  let timerHandle: ReturnType<typeof setInterval> | null = null;
  let timerStartedAt = 0;

  // Replay mode (when viewing another solved participant's game)
  const replayParticipant = ref<ChallengeParticipantDTO | null>(null);
  const replayTimeline = ref<ReplayStepSnapshot[]>([]);
  const replayStepIndex = ref(0);

  // Local WASM Stockfish toggle (unlocked after solved or surrendered)
  const isWasmAnalysisEnabled = ref(false);
  const gaviotaHint = ref<string | null>(null);

  const positionSnapshot = computed(() => analyzeFenPosition(currentFen.value));

  const isFinished = computed(() => {
    const status = challenge.value?.my_entry?.status;
    return status === "solved" || status === "surrendered";
  });

  const isReplayActive = computed(() => Boolean(replayParticipant.value));

  const isBoardInteractive = computed(() => {
    if (isLoading.value || isBotThinking.value) return false;
    if (isReplayActive.value) return false;
    if (isWasmAnalysisEnabled.value) return true;
    if (isFinished.value) return true;
    return positionSnapshot.value.turnColor === challenge.value?.user_color;
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

  function setupBoardFromChallenge(state: ChallengeStateDTO) {
    replayParticipant.value = null;
    replayTimeline.value = [];
    replayStepIndex.value = 0;
    playedUciMoves.value = [];
    playedSanMoves.value = [];
    gaviotaHint.value = null;

    const rawSolution = (state.tactical_solution || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    currentFen.value = state.puzzle_fen;

    if (state.first_move === "bot" && rawSolution[0]) {
      const m0 = rawSolution[0];
      lastMove.value = [m0.slice(0, 2) as Key, m0.slice(2, 4) as Key];
      expectedSolutionMoves.value = rawSolution.slice(1);
    } else {
      lastMove.value = undefined;
      expectedSolutionMoves.value = rawSolution;
    }

    scenarioStepIndex.value = 0;
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
    isWasmAnalysisEnabled.value = false;
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
          startParticipantReplay(res.my_entry);
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
    playChessSound("success");
    triggerHapticNotification("success");
    feedbackBanner.value = {
      type: "success",
      messageKey: "challenge_solved_banner",
    };
    await submitAttemptToBackend(true);
  }

  async function recordFailedAttempt(resetToStart: boolean): Promise<void> {
    playChessSound("error");
    triggerHapticNotification("error");
    feedbackBanner.value = {
      type: "error",
      messageKey: "challenge_wrong_move",
    };
    await submitAttemptToBackend(false);
    if (resetToStart && challenge.value) {
      setupBoardFromChallenge(challenge.value);
    }
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
      playedUciMoves.value.push(applied.uci);
      playedSanMoves.value.push(applied.san);

      playChessSound(
        applied.isCheck
          ? "check"
          : applied.isCapture
            ? "capture"
            : "move"
      );

      void checkGaviotaIfFewPieces(currentFen.value);

      if (applied.isCheckmate) {
        // Bot checkmated the user
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

    // If already finished or in WASM free analysis mode, just play the move on the board
    if (isFinished.value || isWasmAnalysisEnabled.value) {
      try {
        const applied = applyMoveToFen(currentFen.value, uciMove);
        currentFen.value = applied.nextFen;
        lastMove.value = [applied.from, applied.to];
        playedUciMoves.value.push(applied.uci);
        playedSanMoves.value.push(applied.san);
        playChessSound(
          applied.isCheck ? "check" : applied.isCapture ? "capture" : "move"
        );
      } catch {
        // Ignore illegal move
      }
      return;
    }

    feedbackBanner.value = null;

    // 1. Check if we are in the scripted scenario phase
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
        await recordFailedAttempt(false);
        return;
      }

      // Apply correct user move
      currentFen.value = preview.nextFen;
      lastMove.value = [preview.from, preview.to];
      playedUciMoves.value.push(preview.uci);
      playedSanMoves.value.push(preview.san);
      scenarioStepIndex.value += 1;
      triggerHapticImpact("light");
      playChessSound(
        preview.isCheck ? "check" : preview.isCapture ? "capture" : "move"
      );

      // Check if puzzle is immediately solved
      if (
        preview.isCheckmate ||
        (scenarioStepIndex.value >= expectedSolutionMoves.value.length &&
          challenge.value.strategy === "scenarioOnly")
      ) {
        await completeSolvedChallenge();
        return;
      }

      // Play scripted bot reply if available
      const botUci = expectedSolutionMoves.value[scenarioStepIndex.value];
      if (botUci) {
        isBotThinking.value = true;
        await new Promise((r) => setTimeout(r, 260));
        const botApplied = applyMoveToFen(currentFen.value, botUci);
        currentFen.value = botApplied.nextFen;
        lastMove.value = [botApplied.from, botApplied.to];
        playedUciMoves.value.push(botApplied.uci);
        playedSanMoves.value.push(botApplied.san);
        scenarioStepIndex.value += 1;
        isBotThinking.value = false;
        playChessSound(
          botApplied.isCheck
            ? "check"
            : botApplied.isCapture
              ? "capture"
              : "move"
        );
      }

      // If scripted phase just ended in `scenarioPlus`, bot plays next move via Engine Hub
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
    playedUciMoves.value.push(applied.uci);
    playedSanMoves.value.push(applied.san);
    triggerHapticImpact("light");
    playChessSound(
      applied.isCheck ? "check" : applied.isCapture ? "capture" : "move"
    );

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
      isWasmAnalysisEnabled.value = true;
      feedbackBanner.value = {
        type: "info",
        messageKey: "challenge_surrendered_banner",
      };
    } catch (err) {
      console.error("[ChallengeSession] surrender failed:", err);
    }
  }

  function startParticipantReplay(participant: ChallengeParticipantDTO): void {
    if (!challenge.value || !participant.uci_moves) return;
    replayParticipant.value = participant;
    replayTimeline.value = buildReplayTimeline(
      challenge.value.puzzle_fen,
      participant.uci_moves
    );
    setReplayStep(replayTimeline.value.length - 1);
  }

  function setReplayStep(index: number): void {
    if (!replayTimeline.value.length) return;
    const clamped = Math.max(
      0,
      Math.min(replayTimeline.value.length - 1, index)
    );
    replayStepIndex.value = clamped;
    const snap = replayTimeline.value[clamped];
    if (!snap) return;
    currentFen.value = snap.fen;
    lastMove.value = snap.lastMove;
  }

  function exitParticipantReplay(): void {
    if (!challenge.value) return;
    setupBoardFromChallenge(challenge.value);
  }

  return {
    challenge,
    isLoading,
    error,
    currentFen,
    lastMove,
    playedUciMoves,
    playedSanMoves,
    isBotThinking,
    feedbackBanner,
    elapsedMs,
    replayParticipant,
    replayTimeline,
    replayStepIndex,
    isWasmAnalysisEnabled,
    gaviotaHint,
    positionSnapshot,
    isFinished,
    isReplayActive,
    isBoardInteractive,
    loadChallenge,
    handleUserMove,
    surrenderChallenge,
    startParticipantReplay,
    setReplayStep,
    exitParticipantReplay,
    stopTimer,
  };
});

