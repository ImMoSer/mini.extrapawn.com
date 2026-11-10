type SoundKey =
  | "move"
  | "capture"
  | "check"
  | "castle"
  | "promote"
  | "success"
  | "error";

const SOUND_PATHS: Record<SoundKey, string> = {
  move: "/sounds/move.mp3",
  capture: "/sounds/capture.mp3",
  check: "/sounds/check.mp3",
  castle: "/sounds/castle.mp3",
  promote: "/sounds/promote.mp3",
  success: "/sounds/sfx_tactics_success.mp3",
  error: "/sounds/sfx_tactics_error.mp3",
};

const audioCache = new Map<SoundKey, HTMLAudioElement>();

export function playChessSound(key: SoundKey): void {
  if (typeof window === "undefined") return;
  try {
    let audio = audioCache.get(key);
    if (!audio) {
      audio = new Audio(SOUND_PATHS[key]);
      audio.volume = 0.65;
      audioCache.set(key, audio);
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Ignore autoplay restrictions before user interaction
    });
  } catch {
    // Ignore audio errors
  }
}

