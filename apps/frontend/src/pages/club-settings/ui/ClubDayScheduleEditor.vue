<script setup lang="ts">
import { computed } from "vue";
import {
  ALL_DAYS_OF_WEEK,
  type ClubScheduleSlot,
  type DayOfWeekKey,
  type WeeklyScheduleConfig,
} from "shared";
import ClubScheduleSlotCard from "@/pages/club-settings/ui/ClubScheduleSlotCard.vue";
import { useI18n, type TranslationKey } from "@/shared/i18n/useI18n";

const props = defineProps<{
  weeklySchedule: WeeklyScheduleConfig;
  activeDay: DayOfWeekKey;
}>();

const emit = defineEmits<{
  "update:weeklySchedule": [next: WeeklyScheduleConfig];
  "update:activeDay": [day: DayOfWeekKey];
  copiedNotice: [text: string];
}>();

const { t } = useI18n();

const currentDayConfig = computed(() => props.weeklySchedule[props.activeDay]);

function dayLabel(day: DayOfWeekKey): string {
  return t(`day_${day}` as TranslationKey);
}

function hasOverlapInDay(day: DayOfWeekKey): boolean {
  const slots = [...props.weeklySchedule[day].slots].sort(
    (a, b) => a.from_hour - b.from_hour
  );
  for (let i = 1; i < slots.length; i += 1) {
    const prev = slots[i - 1];
    const cur = slots[i];
    if (prev && cur && cur.from_hour < prev.to_hour) {
      return true;
    }
  }
  return false;
}

function cloneSlots(
  slots: ClubScheduleSlot[],
  prefix: string
): ClubScheduleSlot[] {
  return slots.map((s, idx) => ({
    ...s,
    id: `${prefix}-${idx + 1}-${Date.now()}`,
  }));
}

function replaceActiveDaySlot(nextSlot: ClubScheduleSlot) {
  const day = props.activeDay;
  const dayCfg = props.weeklySchedule[day];
  emit("update:weeklySchedule", {
    ...props.weeklySchedule,
    [day]: {
      ...dayCfg,
      slots: dayCfg.slots.map((s) => (s.id === nextSlot.id ? nextSlot : s)),
    },
  });
}

function toggleActiveDayEnabled() {
  const day = props.activeDay;
  const dayCfg = props.weeklySchedule[day];
  emit("update:weeklySchedule", {
    ...props.weeklySchedule,
    [day]: {
      ...dayCfg,
      enabled: !dayCfg.enabled,
    },
  });
}

function copyCurrentDayTo(
  targetDays: readonly DayOfWeekKey[],
  notice: string
) {
  const src = props.weeklySchedule[props.activeDay];
  const next: WeeklyScheduleConfig = { ...props.weeklySchedule };
  for (const d of targetDays) {
    if (d === props.activeDay) continue;
    next[d] = {
      enabled: src.enabled,
      slots: cloneSlots(src.slots, d),
    };
  }
  emit("update:weeklySchedule", next);
  emit("copiedNotice", notice);
}

function addIntervalToActiveDay() {
  const day = props.activeDay;
  const dayCfg = props.weeklySchedule[day];
  if (dayCfg.slots.length >= 8) return;

  const sorted = [...dayCfg.slots].sort((a, b) => a.from_hour - b.from_hour);
  const last = sorted[sorted.length - 1];
  let nextFrom = last ? last.to_hour : 10;
  if (nextFrom >= 24) {
    nextFrom = 6;
  }
  const nextTo = Math.min(24, nextFrom + 2);

  emit("update:weeklySchedule", {
    ...props.weeklySchedule,
    [day]: {
      ...dayCfg,
      slots: [
        ...dayCfg.slots,
        {
          id: `${day}-${Date.now()}`,
          from_hour: nextFrom,
          to_hour: Math.max(nextFrom + 1, nextTo),
          interval_minutes: 15,
          discipline: "tactics",
          difficulty: "Novice",
          focus_group: "all",
          focus_key: "all",
          objective: "all",
        },
      ],
    },
  });
}

function removeIntervalFromActiveDay(slotId: string) {
  const day = props.activeDay;
  const dayCfg = props.weeklySchedule[day];
  emit("update:weeklySchedule", {
    ...props.weeklySchedule,
    [day]: {
      ...dayCfg,
      slots: dayCfg.slots.filter((s) => s.id !== slotId),
    },
  });
}
</script>

<template>
  <!-- 7 Weekday Tabs [Пн..Вс] -->
  <div class="grid grid-cols-7 gap-1 rounded-xl border border-border bg-elevated p-1">
    <button
      v-for="day in ALL_DAYS_OF_WEEK"
      :key="day"
      type="button"
      class="flex flex-col items-center justify-center gap-0.5 rounded-lg py-2 text-xs font-bold transition"
      :class="
        activeDay === day
          ? 'bg-brand text-on-brand'
          : 'text-text-secondary hover:text-text-primary'
      "
      @click="emit('update:activeDay', day)"
    >
      <span>{{ dayLabel(day) }}</span>
      <span
        class="h-1.5 w-1.5 rounded-full"
        :class="
          weeklySchedule[day].enabled && weeklySchedule[day].slots.length > 0
            ? activeDay === day
              ? 'bg-on-brand'
              : 'bg-brand'
            : 'bg-text-disabled/50'
        "
      ></span>
    </button>
  </div>

  <!-- Selected Day Controls: Day On/Off Toggle + Copy Helpers -->
  <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-elevated px-3 py-2.5">
    <button
      type="button"
      class="flex items-center gap-2 text-xs font-bold"
      :class="currentDayConfig.enabled ? 'text-brand' : 'text-text-secondary'"
      @click="toggleActiveDayEnabled"
    >
      <span
        class="relative inline-flex h-5 w-9 items-center rounded-full transition"
        :class="currentDayConfig.enabled ? 'bg-brand' : 'bg-border'"
      >
        <span
          class="inline-block h-3.5 w-3.5 transform rounded-full bg-on-brand transition"
          :class="currentDayConfig.enabled ? 'translate-x-4.5' : 'translate-x-1'"
        ></span>
      </span>
      <span>
        {{ dayLabel(activeDay) }}:
        {{
          currentDayConfig.enabled
            ? t("settings_day_active")
            : t("settings_day_off")
        }}
      </span>
    </button>

    <div class="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        class="rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-text-secondary transition hover:border-brand hover:text-brand"
        @click="
          copyCurrentDayTo(
            ['mon', 'tue', 'wed', 'thu', 'fri'],
            t('settings_copied_weekdays')
          )
        "
      >
        {{ t("settings_copy_weekdays") }}
      </button>

      <button
        type="button"
        class="rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-text-secondary transition hover:border-brand hover:text-brand"
        @click="
          copyCurrentDayTo(ALL_DAYS_OF_WEEK, t('settings_copied_all_week'))
        "
      >
        {{ t("settings_copy_all_week") }}
      </button>
    </div>
  </div>

  <!-- Day Off Placeholder -->
  <div
    v-if="!currentDayConfig.enabled"
    class="rounded-lg border border-dashed border-border py-6 text-center text-xs text-text-secondary"
  >
    {{ t("settings_day_off_placeholder") }} ({{ t("settings_day_off") }}).
  </div>

  <!-- Active Day Interval Slots -->
  <div v-else class="flex flex-col gap-3">
    <div
      v-if="hasOverlapInDay(activeDay)"
      class="rounded-lg border border-danger/40 bg-danger/15 px-3 py-2 text-xs font-semibold text-danger"
    >
      {{ t("settings_day_overlap_warn") }}
    </div>

    <ClubScheduleSlotCard
      v-for="(itemSlot, idx) in currentDayConfig.slots"
      :key="itemSlot.id"
      :schedule-slot="itemSlot"
      :index="idx"
      @update-slot="replaceActiveDaySlot"
      @remove-slot="removeIntervalFromActiveDay(itemSlot.id)"
    />

    <!-- Add Interval Button -->
    <button
      v-if="currentDayConfig.slots.length < 8"
      type="button"
      class="w-full rounded-lg border border-dashed border-brand/50 bg-surface py-2.5 text-xs font-bold text-brand transition hover:border-brand hover:bg-elevated"
      @click="addIntervalToActiveDay"
    >
      {{ t("settings_add_interval") }}
    </button>
  </div>
</template>
