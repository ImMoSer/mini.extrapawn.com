<script setup lang="ts">
import type {
  ChallengeDiscipline,
  ChallengeParticipantDTO,
  ReplaySpeedMode,
} from "shared";
import { useI18n } from "@/shared/i18n/useI18n";

const props = defineProps<{
  leaderboard: ChallengeParticipantDTO[];
  discipline: ChallengeDiscipline;
  isFinished: boolean;
  replayParticipant: ChallengeParticipantDTO | null;
  autoPlaySpeed: ReplaySpeedMode | null;
  isAutoPlaying: boolean;
}>();

const emit = defineEmits<{
  replay: [participant: ChallengeParticipantDTO, speed: ReplaySpeedMode];
  exitReplay: [];
}>();

const { t } = useI18n();

function canReplayParticipant(p: ChallengeParticipantDTO): boolean {
  return (
    props.isFinished &&
    props.discipline !== "tactics" &&
    p.solved &&
    Boolean(p.uci_moves && p.uci_moves.trim().length > 0)
  );
}

function hasMoveTimings(p: ChallengeParticipantDTO): boolean {
  return Array.isArray(p.move_times_ms) && p.move_times_ms.length > 0;
}

function isParticipantSelected(
  p: ChallengeParticipantDTO,
  speed: ReplaySpeedMode
): boolean {
  return (
    props.replayParticipant?.telegram_id === p.telegram_id &&
    props.autoPlaySpeed === speed
  );
}
</script>

<template>
  <section class="glass flex flex-col gap-2 p-3">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-xs font-bold tracking-wider text-text-secondary uppercase">
        {{ t("challenge_leaderboard_title") }} ({{ leaderboard.length }})
      </h2>
      <span v-if="!isFinished" class="text-[11px] text-text-secondary">
        {{ t("challenge_moves_locked") }}
      </span>
    </div>

    <div class="flex flex-col divide-y divide-border">
      <div
        v-for="p in leaderboard"
        :key="p.telegram_id"
        class="flex items-center justify-between gap-2 py-2 text-xs"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class="w-5 shrink-0 font-condensed font-bold text-text-secondary">
            #{{ p.rank }}
          </span>
          <span class="min-w-0 truncate font-bold text-text-primary">
            {{ p.display_name }}
          </span>
        </div>

        <div class="flex shrink-0 items-center gap-1.5">
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
            class="w-11 text-right font-condensed text-text-secondary"
          >
            {{ (Math.round((p.solved_time_ms / 1000) * 10) / 10).toFixed(1) }}s
          </span>

          <!-- Two compact side-by-side replay buttons: [Игра / Game] and [▶▶] -->
          <div
            v-if="canReplayParticipant(p)"
            class="flex items-center gap-1"
          >
            <button
              v-if="hasMoveTimings(p)"
              type="button"
              class="min-w-0 truncate rounded border px-2 py-0.5 text-[11px] font-bold transition"
              :class="
                isParticipantSelected(p, 'game')
                  ? 'border-brand bg-brand text-on-brand'
                  : 'border-brand/40 bg-elevated text-brand hover:border-brand'
              "
              @click="emit('replay', p, 'game')"
            >
              {{
                isParticipantSelected(p, "game") && isAutoPlaying
                  ? "⏸"
                  : t("challenge_replay_game")
              }}
            </button>

            <button
              type="button"
              class="min-w-0 truncate rounded border px-2 py-0.5 text-[11px] font-bold transition"
              :class="
                isParticipantSelected(p, 'fast')
                  ? 'border-brand bg-brand text-on-brand'
                  : 'border-brand/40 bg-elevated text-brand hover:border-brand'
              "
              @click="emit('replay', p, 'fast')"
            >
              {{
                isParticipantSelected(p, "fast") && isAutoPlaying
                  ? "⏸"
                  : t("challenge_replay_fast")
              }}
            </button>

            <button
              v-if="replayParticipant?.telegram_id === p.telegram_id"
              type="button"
              class="rounded border border-border bg-elevated px-1.5 py-0.5 text-[10px] font-bold text-text-secondary transition hover:text-text-primary"
              :title="t('challenge_exit_replay')"
              @click="emit('exitReplay')"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
