export type SoundKey =
  | "move"
  | "capture"
  | "castle"
  | "promote"
  | "check"
  | "load_position"
  | "chpock"
  | "tactics_error"
  | "tactics_success"
  | "victory_applause"
  | "applause"
  | "checkmate"
  | "stalemate"
  | "draw_by_repetition"
  | "fifty_moves_no_progress"
  | "insufficient_material"
  | "draw"
  | "timer_10s"
  | "timer_8s"
  | "timer_times_up"
  | "success"
  | "error";

const SOUND_DEFINITIONS: Record<SoundKey, string | readonly string[]> = {
  move: "/sounds/move.mp3",
  capture: "/sounds/capture.mp3",
  castle: "/sounds/castle.mp3",
  promote: "/sounds/promote.mp3",
  check: "/sounds/check.mp3",
  load_position: "/sounds/load_position.mp3",
  chpock: "/sounds/sfx_chpock.mp3",
  tactics_error: "/sounds/sfx_tactics_error.mp3",
  tactics_success: "/sounds/sfx_tactics_success.mp3",
  success: "/sounds/sfx_tactics_success.mp3",
  error: "/sounds/sfx_tactics_error.mp3",
  victory_applause: "/sounds/applause/applause_1.mp3",
  applause: [
    "/sounds/applause/applause_1.mp3",
    "/sounds/applause/applause_2.mp3",
    "/sounds/applause/applause_3.mp3",
    "/sounds/applause/applause_4.mp3",
  ],
  checkmate: "/sounds/chess_result/checkmate.mp3",
  stalemate: "/sounds/chess_result/stalemate.mp3",
  draw_by_repetition: "/sounds/chess_result/draw_by_repetition.mp3",
  fifty_moves_no_progress: "/sounds/chess_result/fifty_moves_no_progress.mp3",
  insufficient_material: "/sounds/chess_result/insufficient_material.mp3",
  draw: "/sounds/chess_result/stalemate.mp3",
  timer_10s: "/sounds/timer/timer_10s.mp3",
  timer_8s: "/sounds/timer/timer_8s.mp3",
  timer_times_up: "/sounds/timer/timer_times_up.mp3",
};

class SoundServiceController {
  private audioPool: Map<string, HTMLAudioElement[]> = new Map();
  private activeSounds: Set<HTMLAudioElement> = new Set();
  private volumeLevel = 0.85;

  private acquireAudio(path: string): HTMLAudioElement | null {
    if (typeof window === "undefined" || typeof Audio === "undefined") {
      return null;
    }
    let pool = this.audioPool.get(path);
    if (!pool) {
      pool = [];
      this.audioPool.set(path, pool);
    }

    const idleAudio = pool.find(
      (el) => !this.activeSounds.has(el) && (el.paused || el.ended)
    );
    if (idleAudio) {
      try {
        idleAudio.currentTime = 0;
      } catch {
        // Ignore if metadata is not yet loaded
      }
      return idleAudio;
    }

    const audio = new Audio(path);
    audio.preload = "auto";
    pool.push(audio);
    return audio;
  }

  public play(key: SoundKey, _context?: string): void {
    const pathOrPool = SOUND_DEFINITIONS[key];
    const path =
      typeof pathOrPool === "string"
        ? pathOrPool
        : pathOrPool[Math.floor(Math.random() * pathOrPool.length)];
    if (!path) return;

    const audio = this.acquireAudio(path);
    if (!audio) return;

    audio.volume = this.volumeLevel;
    const cleanup = () => {
      this.activeSounds.delete(audio);
      audio.onended = null;
      audio.onerror = null;
    };

    audio.onended = cleanup;
    audio.onerror = cleanup;
    this.activeSounds.add(audio);

    try {
      void audio.play().catch(() => {
        cleanup();
      });
    } catch {
      cleanup();
    }
  }
}

export const soundService = new SoundServiceController();

export function playChessSound(key: SoundKey): void {
  soundService.play(key);
}

export function playAppliedMoveSound(move: {
  isCheckmate?: boolean;
  isStalemate?: boolean;
  isInsufficientMaterial?: boolean;
  isFiftyMoves?: boolean;
  isCheck: boolean;
  isPromotion?: boolean;
  isCastle?: boolean;
  isCapture: boolean;
}): void {
  if (move.isCheckmate) {
    soundService.play("checkmate");
    return;
  }
  if (move.isStalemate) {
    soundService.play("stalemate");
    return;
  }
  if (move.isInsufficientMaterial) {
    soundService.play("insufficient_material");
    return;
  }
  if (move.isFiftyMoves) {
    soundService.play("fifty_moves_no_progress");
    return;
  }
  if (move.isCheck) {
    soundService.play("check");
    return;
  }
  if (move.isPromotion) {
    soundService.play("promote");
    return;
  }
  if (move.isCastle) {
    soundService.play("castle");
    return;
  }
  if (move.isCapture) {
    soundService.play("capture");
    return;
  }
  soundService.play("move");
}

