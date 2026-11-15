<script setup lang="ts">
import {
  ALL_CHALLENGE_DIFFICULTIES,
  ALL_CHALLENGE_DISCIPLINES,
  ALL_SCHEDULE_INTERVALS,
  getWarmupTileLabel,
  getWarmupTilesForDiscipline,
  type ChallengeDiscipline,
  type ClubScheduleSlot,
  type ScheduleIntervalMinutes,
  type WarmupFocusTile,
} from "shared";
import { useI18n } from "@/shared/i18n/useI18n";

const props = defineProps<{
  scheduleSlot: ClubScheduleSlot;
  index: number;
}>();

const emit = defineEmits<{
  updateSlot: [next: ClubScheduleSlot];
  removeSlot: [];
}>();

const { lang, t, disciplineTitle, difficultyTitle } = useI18n();

const FROM_HOURS = [
  6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
] as const;
const ALL_TO_HOURS = [
  7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
] as const;

function formatHour(hour: number): string {
  const displayHour = hour === 24 ? 0 : hour;
  return `${String(displayHour).padStart(2, "0")}:00`;
}

function getToHoursForSlot(fromHour: number): number[] {
  return ALL_TO_HOURS.filter((h) => h > fromHour);
}

function handleFromHourChange(rawValue: string) {
  const nextFrom = Number.parseInt(rawValue, 10);
  if (Number.isNaN(nextFrom)) return;
  const fromHour = Math.min(23, Math.max(6, nextFrom));
  const toHour =
    props.scheduleSlot.to_hour <= fromHour
      ? Math.min(24, fromHour + 1)
      : props.scheduleSlot.to_hour;
  emit("updateSlot", {
    ...props.scheduleSlot,
    from_hour: fromHour,
    to_hour: toHour,
  });
}

function handleToHourChange(rawValue: string) {
  const nextTo = Number.parseInt(rawValue, 10);
  if (Number.isNaN(nextTo)) return;
  emit("updateSlot", {
    ...props.scheduleSlot,
    to_hour: Math.min(24, Math.max(props.scheduleSlot.from_hour + 1, nextTo)),
  });
}

function handleIntervalChange(rawValue: string) {
  const parsed = Number.parseInt(rawValue, 10) as ScheduleIntervalMinutes;
  if (!(ALL_SCHEDULE_INTERVALS as readonly number[]).includes(parsed)) return;
  emit("updateSlot", { ...props.scheduleSlot, interval_minutes: parsed });
}

function selectDiscipline(disc: ChallengeDiscipline) {
  if (props.scheduleSlot.discipline === disc) return;
  emit("updateSlot", {
    ...props.scheduleSlot,
    discipline: disc,
    focus_group: "all",
    focus_key: "all",
    objective: "all",
  });
}

function selectFocusTile(tile: WarmupFocusTile) {
  if (tile.id === "mix") {
    emit("updateSlot", {
      ...props.scheduleSlot,
      focus_group: "all",
      focus_key: "all",
      objective: "all",
    });
    return;
  }
  if (tile.focusGroup === "objective") {
    emit("updateSlot", {
      ...props.scheduleSlot,
      focus_group: "objective",
      focus_key: tile.focusKey,
      objective: tile.focusKey,
    });
    return;
  }
  emit("updateSlot", {
    ...props.scheduleSlot,
    focus_group: tile.focusGroup,
    focus_key: tile.focusKey,
    objective: "all",
  });
}

function isTileSelected(tile: WarmupFocusTile): boolean {
  if (tile.id === "mix") {
    return props.scheduleSlot.focus_key === "all";
  }
  return props.scheduleSlot.focus_key === tile.focusKey;
}
</script>

<template>
  <div class="flex flex-col gap-3 rounded-xl border border-border bg-elevated p-3.5">
    <!-- Row 1: Interval Dropdowns (From - To - Every) + Delete -->
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="rounded bg-surface px-2 py-0.5 font-condensed font-bold text-brand">
          #{{ index + 1 }}
        </span>

        <label class="flex items-center gap-1.5">
          <span class="text-text-secondary">{{ t("settings_from") }}</span>
          <select
            :value="scheduleSlot.from_hour"
            class="rounded-md border border-border bg-surface px-2 py-1 font-condensed text-xs font-bold text-text-primary focus:border-brand focus:outline-none"
            @change="handleFromHourChange(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="h in FROM_HOURS" :key="h" :value="h">
              {{ formatHour(h) }}
            </option>
          </select>
        </label>

        <label class="flex items-center gap-1.5">
          <span class="text-text-secondary">{{ t("settings_to") }}</span>
          <select
            :value="scheduleSlot.to_hour"
            class="rounded-md border border-border bg-surface px-2 py-1 font-condensed text-xs font-bold text-text-primary focus:border-brand focus:outline-none"
            @change="handleToHourChange(($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="h in getToHoursForSlot(scheduleSlot.from_hour)"
              :key="h"
              :value="h"
            >
              {{ formatHour(h) }}
            </option>
          </select>
        </label>

        <label class="flex items-center gap-1.5">
          <span class="text-text-secondary">{{ t("settings_every") }}</span>
          <select
            :value="scheduleSlot.interval_minutes"
            class="rounded-md border border-border bg-surface px-2 py-1 font-condensed text-xs font-bold text-brand focus:border-brand focus:outline-none"
            @change="handleIntervalChange(($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="mins in ALL_SCHEDULE_INTERVALS"
              :key="mins"
              :value="mins"
            >
              {{ mins }} {{ t("settings_min") }}
            </option>
          </select>
        </label>
      </div>

      <button
        type="button"
        class="rounded-md border border-border bg-surface px-2 py-1 text-xs font-bold text-text-secondary transition hover:border-danger hover:text-danger"
        :title="t('settings_remove_interval')"
        @click="emit('removeSlot')"
      >
        ✕
      </button>
    </div>

    <!-- Row 2: Single Discipline per Interval -->
    <div class="flex flex-col gap-1.5">
      <span class="text-[11px] font-bold tracking-wider text-text-secondary uppercase">
        {{ t("settings_slot_discipline") }}
      </span>
      <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <button
          v-for="disc in ALL_CHALLENGE_DISCIPLINES"
          :key="disc"
          type="button"
          class="min-w-0 truncate rounded-lg border px-2.5 py-2 text-center text-[11px] font-bold uppercase transition"
          :class="
            scheduleSlot.discipline === disc
              ? 'border-brand bg-brand/15 text-brand'
              : 'border-border bg-surface text-text-secondary hover:border-border-hover'
          "
          @click="selectDiscipline(disc)"
        >
          {{ disciplineTitle(disc) }}
        </button>
      </div>
    </div>

    <!-- Row 3: Single Difficulty per Interval -->
    <div class="flex flex-col gap-1.5">
      <span class="text-[11px] font-bold tracking-wider text-text-secondary uppercase">
        {{ t("settings_slot_difficulty") }}
      </span>
      <div class="grid grid-cols-3 gap-1.5">
        <button
          v-for="diff in ALL_CHALLENGE_DIFFICULTIES"
          :key="diff"
          type="button"
          class="flex min-w-0 flex-col items-center rounded-lg border py-1.5 text-center transition"
          :class="
            scheduleSlot.difficulty === diff
              ? 'border-brand bg-brand/15 text-brand'
              : 'border-border bg-surface text-text-secondary hover:border-border-hover'
          "
          @click="emit('updateSlot', { ...scheduleSlot, difficulty: diff })"
        >
          <span class="w-full truncate px-1 text-xs font-bold">
            {{ difficultyTitle(diff) }}
          </span>
          <span class="text-[10px] opacity-80">MOZERO</span>
        </button>
      </div>
    </div>

    <!-- Row 4: Focus / Theme Tile for this Interval's Discipline -->
    <div class="flex flex-col gap-1.5">
      <span class="text-[11px] font-bold tracking-wider text-text-secondary uppercase">
        {{ t("settings_slot_focus") }} ({{ disciplineTitle(scheduleSlot.discipline) }})
      </span>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="tile in getWarmupTilesForDiscipline(scheduleSlot.discipline)"
          :key="tile.id"
          type="button"
          class="rounded-md border px-2.5 py-1 text-xs font-semibold transition"
          :class="
            isTileSelected(tile)
              ? 'border-brand bg-brand/15 font-bold text-brand'
              : 'border-border bg-surface text-text-secondary hover:border-border-hover'
          "
          @click="selectFocusTile(tile)"
        >
          {{ getWarmupTileLabel(tile, lang) }}
        </button>
      </div>
    </div>
  </div>
</template>
