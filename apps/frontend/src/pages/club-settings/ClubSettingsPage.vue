<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ALL_CHALLENGE_DIFFICULTIES,
  ALL_CHALLENGE_DISCIPLINES,
  ALL_DAYS_OF_WEEK,
  ALL_SCHEDULE_INTERVALS,
  CLUB_TIMEZONE_OPTIONS,
  createDefaultWeeklySchedule,
  getClubTimezoneOptionLabel,
  getWarmupTileLabel,
  getWarmupTilesForDiscipline,
  normalizeWeeklySchedule,
  type AppLanguage,
  type ChallengeDiscipline,
  type ClubScheduleSlot,
  type ClubSummaryDTO,
  type DayOfWeekKey,
  type ScheduleIntervalMinutes,
  type WarmupFocusTile,
  type WeeklyScheduleConfig,
} from "shared";
import { useCabinetStore } from "@/entities/cabinet/model/cabinet.store";
import { apiRequest } from "@/shared/api/httpClient";
import { useI18n, type TranslationKey } from "@/shared/i18n/useI18n";

const route = useRoute();
const router = useRouter();
const cabinetStore = useCabinetStore();
const { lang, t, disciplineTitle, difficultyTitle } = useI18n();

const chatId = computed(() => String(route.params.chatId || ""));

const FROM_HOURS = [
  6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
] as const;
const ALL_TO_HOURS = [
  7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
] as const;

function detectTodayKey(): DayOfWeekKey {
  const jsDay = new Date().getDay(); // 0 = Sun, 1 = Mon .. 6 = Sat
  const map: readonly DayOfWeekKey[] = [
    "sun",
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
  ];
  return map[jsDay] ?? "mon";
}

const club = ref<ClubSummaryDTO | null>(null);
const isLoading = ref(false);
const isSaving = ref(false);
const isPublishing = ref(false);
const isTogglingActive = ref(false);
const isDisconnecting = ref(false);
const statusBanner = ref<{ type: "success" | "error"; text: string } | null>(
  null
);

const isClubActive = ref(true);
const activeDay = ref<DayOfWeekKey>(detectTodayKey());
const weeklySchedule = ref<WeeklyScheduleConfig>(createDefaultWeeklySchedule());
const clubLanguage = ref<AppLanguage>("ru");
const clubTimezone = ref<string>("Europe/Berlin");
const savedSnapshot = ref<string>("");

const hasCustomTimezone = computed(
  () =>
    Boolean(clubTimezone.value) &&
    !CLUB_TIMEZONE_OPTIONS.some((opt) => opt.value === clubTimezone.value)
);

function buildSettingsSnapshot(): string {
  return JSON.stringify({
    language: clubLanguage.value,
    timezone: clubTimezone.value,
    weekly_schedule: weeklySchedule.value,
  });
}

const isDirty = computed(
  () =>
    savedSnapshot.value !== "" &&
    buildSettingsSnapshot() !== savedSnapshot.value
);

const currentDayConfig = computed(() => weeklySchedule.value[activeDay.value]);

function formatHour(hour: number): string {
  const displayHour = hour === 24 ? 0 : hour;
  return `${String(displayHour).padStart(2, "0")}:00`;
}

function getToHoursForSlot(fromHour: number): number[] {
  return ALL_TO_HOURS.filter((h) => h > fromHour);
}

function dayLabel(day: DayOfWeekKey): string {
  return t(`day_${day}` as TranslationKey);
}

function hasOverlapInDay(day: DayOfWeekKey): boolean {
  const slots = [...weeklySchedule.value[day].slots].sort(
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

const overlappingDays = computed<DayOfWeekKey[]>(() =>
  ALL_DAYS_OF_WEEK.filter((d) => hasOverlapInDay(d))
);

function cloneSlots(slots: ClubScheduleSlot[], prefix: string): ClubScheduleSlot[] {
  return slots.map((s, idx) => ({
    ...s,
    id: `${prefix}-${idx + 1}-${Date.now()}`,
  }));
}

function copyCurrentDayTo(targetDays: readonly DayOfWeekKey[], notice: string) {
  const src = weeklySchedule.value[activeDay.value];
  for (const d of targetDays) {
    if (d === activeDay.value) continue;
    weeklySchedule.value[d] = {
      enabled: src.enabled,
      slots: cloneSlots(src.slots, d),
    };
  }
  statusBanner.value = { type: "success", text: notice };
}

function handleFromHourChange(slot: ClubScheduleSlot, rawValue: string) {
  const nextFrom = Number.parseInt(rawValue, 10);
  if (Number.isNaN(nextFrom)) return;
  slot.from_hour = Math.min(23, Math.max(6, nextFrom));
  if (slot.to_hour <= slot.from_hour) {
    slot.to_hour = Math.min(24, slot.from_hour + 1);
  }
}

function handleToHourChange(slot: ClubScheduleSlot, rawValue: string) {
  const nextTo = Number.parseInt(rawValue, 10);
  if (Number.isNaN(nextTo)) return;
  slot.to_hour = Math.min(24, Math.max(slot.from_hour + 1, nextTo));
}

function handleIntervalChange(slot: ClubScheduleSlot, rawValue: string) {
  const parsed = Number.parseInt(rawValue, 10) as ScheduleIntervalMinutes;
  if ((ALL_SCHEDULE_INTERVALS as readonly number[]).includes(parsed)) {
    slot.interval_minutes = parsed;
  }
}

function selectSlotDiscipline(slot: ClubScheduleSlot, disc: ChallengeDiscipline) {
  if (slot.discipline === disc) return;
  slot.discipline = disc;
  slot.focus_group = "all";
  slot.focus_key = "all";
  slot.objective = "all";
}

function selectSlotFocusTile(slot: ClubScheduleSlot, tile: WarmupFocusTile) {
  if (tile.id === "mix") {
    slot.focus_group = "all";
    slot.focus_key = "all";
    slot.objective = "all";
    return;
  }
  if (tile.focusGroup === "objective") {
    slot.focus_group = "objective";
    slot.focus_key = tile.focusKey;
    slot.objective = tile.focusKey;
    return;
  }
  slot.focus_group = tile.focusGroup;
  slot.focus_key = tile.focusKey;
  slot.objective = "all";
}

function isSlotTileSelected(slot: ClubScheduleSlot, tile: WarmupFocusTile): boolean {
  if (tile.id === "mix") {
    return slot.focus_key === "all";
  }
  return slot.focus_key === tile.focusKey;
}

function addIntervalToActiveDay() {
  const dayCfg = weeklySchedule.value[activeDay.value];
  if (dayCfg.slots.length >= 8) return;

  const sorted = [...dayCfg.slots].sort((a, b) => a.from_hour - b.from_hour);
  const last = sorted[sorted.length - 1];
  let nextFrom = last ? last.to_hour : 10;
  if (nextFrom >= 24) {
    nextFrom = 6;
  }
  const nextTo = Math.min(24, nextFrom + 2);

  dayCfg.slots.push({
    id: `${activeDay.value}-${Date.now()}`,
    from_hour: nextFrom,
    to_hour: Math.max(nextFrom + 1, nextTo),
    interval_minutes: 15,
    discipline: "tactics",
    difficulty: "Novice",
    focus_group: "all",
    focus_key: "all",
    objective: "all",
  });
}

function removeIntervalFromActiveDay(slotId: string) {
  const dayCfg = weeklySchedule.value[activeDay.value];
  dayCfg.slots = dayCfg.slots.filter((s) => s.id !== slotId);
}

async function toggleMasterActive() {
  if (isTogglingActive.value || !club.value) return;
  isTogglingActive.value = true;
  statusBanner.value = null;
  try {
    const nextVal = !isClubActive.value;
    const updated = await cabinetStore.toggleClubActive(chatId.value, nextVal);
    if (updated) {
      club.value = updated;
      isClubActive.value = updated.is_active;
    }
  } finally {
    isTogglingActive.value = false;
  }
}

async function loadClub() {
  isLoading.value = true;
  try {
    const res = await apiRequest<ClubSummaryDTO>(
      `/clubs/${encodeURIComponent(chatId.value)}`
    );
    club.value = res;
    isClubActive.value = res.is_active;
    weeklySchedule.value = normalizeWeeklySchedule(res.weekly_schedule);
    clubLanguage.value = res.language || "ru";
    clubTimezone.value = res.timezone || "Europe/Berlin";
    savedSnapshot.value = buildSettingsSnapshot();
  } finally {
    isLoading.value = false;
  }
}

async function saveSettings(): Promise<boolean> {
  if (overlappingDays.value.length > 0) {
    statusBanner.value = {
      type: "error",
      text: "Интервалы времени не должны пересекаться в пределах одного дня!",
    };
    return false;
  }

  isSaving.value = true;
  statusBanner.value = null;
  try {
    const updated = await apiRequest<ClubSummaryDTO>(
      `/clubs/${encodeURIComponent(chatId.value)}/settings`,
      {
        method: "PUT",
        body: JSON.stringify({
          is_active: isClubActive.value,
          language: clubLanguage.value,
          timezone: clubTimezone.value,
          weekly_schedule: weeklySchedule.value,
          leaderboard_cron_days: club.value?.leaderboard_cron_days ?? 3,
        }),
      }
    );
    club.value = updated;
    isClubActive.value = updated.is_active;
    weeklySchedule.value = normalizeWeeklySchedule(updated.weekly_schedule);
    clubLanguage.value = updated.language || "ru";
    clubTimezone.value = updated.timezone || "Europe/Berlin";
    savedSnapshot.value = buildSettingsSnapshot();
    statusBanner.value = { type: "success", text: t("settings_saved_ok") };
    return true;
  } catch (err) {
    statusBanner.value = {
      type: "error",
      text: err instanceof Error ? err.message : String(err),
    };
    return false;
  } finally {
    isSaving.value = false;
  }
}

async function publishChallengeNow() {
  isPublishing.value = true;
  statusBanner.value = null;
  try {
    if (isDirty.value) {
      const ok = await saveSettings();
      if (!ok) return;
    }

    const currentHour = new Date().getHours();
    const activeSlots = weeklySchedule.value[activeDay.value].slots;
    const chosenSlot =
      activeSlots.find(
        (s) => currentHour >= s.from_hour && currentHour < s.to_hour
      ) ?? activeSlots[0];
    const res = await apiRequest<{
      ok: boolean;
      challenge: {
        discipline: ChallengeDiscipline;
        puzzleId: string;
        edition: string;
        chatId: string;
      };
    }>(`/clubs/${encodeURIComponent(chatId.value)}/publish-now`, {
      method: "POST",
      body: JSON.stringify(
        chosenSlot
          ? {
              discipline: chosenSlot.discipline,
              difficulty: chosenSlot.difficulty,
              focusGroup: chosenSlot.focus_group,
              focusKey: chosenSlot.focus_key,
              objective: chosenSlot.objective,
            }
          : {}
      ),
    });

    if (res.challenge) {
      await router.push(
        `/challenge/${res.challenge.discipline}/${encodeURIComponent(
          res.challenge.puzzleId
        )}/${encodeURIComponent(
          res.challenge.edition
        )}/${encodeURIComponent(res.challenge.chatId)}`
      );
    }
  } catch (err) {
    statusBanner.value = {
      type: "error",
      text: err instanceof Error ? err.message : String(err),
    };
  } finally {
    isPublishing.value = false;
  }
}

async function disconnectAndPurgeClub() {
  if (!club.value || isDisconnecting.value) return;
  if (!window.confirm(t("settings_disconnect_confirm"))) return;

  isDisconnecting.value = true;
  statusBanner.value = null;
  try {
    await apiRequest(`/clubs/${encodeURIComponent(chatId.value)}`, {
      method: "DELETE",
    });
    await cabinetStore.fetchCabinet();
    await router.push("/clubs");
  } catch (err) {
    statusBanner.value = {
      type: "error",
      text: err instanceof Error ? err.message : String(err),
    };
  } finally {
    isDisconnecting.value = false;
  }
}

onMounted(() => {
  void loadClub();
});
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4 px-3 py-4">
    <!-- Club Settings Header + Quick Master Active Toggle -->
    <section
      v-if="club"
      class="glass flex flex-col gap-3 p-4"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <button
            type="button"
            class="mb-1 text-[11px] font-semibold text-text-secondary transition hover:text-brand"
            @click="router.push('/cabinet')"
          >
            ← {{ t("nav_cabinet") }}
          </button>
          <div class="text-xs font-bold tracking-wider text-brand uppercase">
            {{ t("settings_title") }}
          </div>
          <h1 class="mt-0.5 text-base font-bold text-text-primary">
            {{ club.title }} (Topic #{{ club.topic_thread_id }})
          </h1>
        </div>

        <!-- Master Toggle Switch (active: true / false) -->
        <button
          v-if="club.status !== 'blocked'"
          type="button"
          :disabled="isTogglingActive"
          class="flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition"
          :class="
            isClubActive
              ? 'border-brand bg-brand/15 text-brand'
              : 'border-border bg-elevated text-text-secondary'
          "
          @click="toggleMasterActive"
        >
          <span
            class="relative inline-flex h-5 w-9 items-center rounded-full transition"
            :class="isClubActive ? 'bg-brand' : 'bg-border'"
          >
            <span
              class="inline-block h-3.5 w-3.5 transform rounded-full bg-on-brand transition"
              :class="isClubActive ? 'translate-x-4.5' : 'translate-x-1'"
            ></span>
          </span>
          <span>
            {{
              isClubActive
                ? t("settings_bot_active")
                : t("settings_bot_paused")
            }}
          </span>
        </button>
      </div>

      <!-- Smart Auto-Pause Notice -->
      <div
        v-if="club.auto_paused && isClubActive && club.status !== 'blocked'"
        class="rounded-lg border border-warning/40 bg-warning/15 px-3 py-2 text-xs text-warning"
      >
        ⏸ <strong>{{ t("settings_auto_paused_badge") }}</strong> — расписание автоматически возобновится, как только кто-то в клубе решит активную задачу или сдастся.
      </div>

      <!-- Blocked Club Notice with @ProfessorMozer link & QR Code -->
      <div
        v-if="club.status === 'blocked'"
        class="flex flex-col items-center gap-3 rounded-xl border border-danger/50 bg-danger/15 p-4 text-center"
      >
        <div class="text-sm font-bold text-danger">
          ⛔ {{ t("settings_blocked_title") }}
        </div>
        <p class="text-xs text-text-primary">
          {{ t("settings_blocked_desc") }}
          <a
            href="https://t.me/ProfessorMozer"
            target="_blank"
            rel="noopener noreferrer"
            class="font-bold text-brand underline hover:opacity-80"
          >
            @ProfessorMozer
          </a>
        </p>
        <a
          href="https://t.me/ProfessorMozer"
          target="_blank"
          rel="noopener noreferrer"
          class="overflow-hidden rounded-xl border border-border bg-surface p-2 transition hover:border-brand"
        >
          <img
            src="/professor_mozer_qr.png"
            alt="@ProfessorMozer QR"
            class="h-40 w-40 object-contain"
          />
        </a>
      </div>
    </section>

    <!-- Feedback Banner -->
    <div
      v-if="statusBanner"
      class="rounded-lg border px-3 py-2 text-xs font-bold"
      :class="
        statusBanner.type === 'success'
          ? 'border-success/40 bg-success/15 text-success'
          : 'border-danger/40 bg-danger/15 text-danger'
      "
    >
      {{ statusBanner.text }}
    </div>

    <!-- 7 Weekday Schedule Tabs + Intervals -->
    <section class="glass flex flex-col gap-3.5 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-xs font-bold tracking-wider text-text-secondary uppercase">
          {{ t("settings_step_4") }}
        </h2>
        <span class="font-condensed text-[11px] text-brand font-bold">
          06:00 – 00:00 ({{ clubTimezone }})
        </span>
      </div>

      <!-- Curated Club Timezone Selector (Default Europe/Berlin) -->
      <div class="flex flex-col gap-1.5 rounded-lg border border-border bg-elevated p-3">
        <label class="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
          <span class="text-xs font-bold text-text-primary">
            🌍 {{ t("settings_club_timezone") }}
          </span>
          <select
            v-model="clubTimezone"
            class="rounded-md border border-border bg-surface px-2.5 py-1.5 font-condensed text-xs font-bold text-text-primary focus:border-brand focus:outline-none"
          >
            <option
              v-for="tzOpt in CLUB_TIMEZONE_OPTIONS"
              :key="tzOpt.value"
              :value="tzOpt.value"
            >
              {{ getClubTimezoneOptionLabel(tzOpt, lang) }}
            </option>
            <option v-if="hasCustomTimezone" :value="clubTimezone">
              {{ clubTimezone }}
            </option>
          </select>
        </label>
        <p class="text-[11px] text-text-secondary">
          {{ t("settings_club_timezone_hint") }}
        </p>
      </div>

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
          @click="activeDay = day"
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
          @click="currentDayConfig.enabled = !currentDayConfig.enabled"
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
                'Расписание скопировано на будни (Пн–Пт)'
              )
            "
          >
            {{ t("settings_copy_weekdays") }}
          </button>

          <button
            type="button"
            class="rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-text-secondary transition hover:border-brand hover:text-brand"
            @click="
              copyCurrentDayTo(
                ALL_DAYS_OF_WEEK,
                'Расписание применено ко всей неделе (Пн–Вс)'
              )
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
        😴 В этот день недели публикация челленджей отключена ({{ t("settings_day_off") }}).
      </div>

      <!-- Active Day Interval Slots -->
      <div v-else class="flex flex-col gap-3">
        <div
          v-if="hasOverlapInDay(activeDay)"
          class="rounded-lg border border-danger/40 bg-danger/15 px-3 py-2 text-xs font-semibold text-danger"
        >
          ⚠️ Интервалы на этот день пересекаются! Пожалуйста, скорректируйте часы начала/окончания.
        </div>

        <div
          v-for="(slot, idx) in currentDayConfig.slots"
          :key="slot.id"
          class="flex flex-col gap-3 rounded-xl border border-border bg-elevated p-3.5"
        >
          <!-- Row 1: Interval Dropdowns (From - To - Every) + Delete -->
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span class="rounded bg-surface px-2 py-0.5 font-condensed font-bold text-brand">
                #{{ idx + 1 }}
              </span>

              <label class="flex items-center gap-1.5">
                <span class="text-text-secondary">{{ t("settings_from") }}</span>
                <select
                  :value="slot.from_hour"
                  class="rounded-md border border-border bg-surface px-2 py-1 font-condensed text-xs font-bold text-text-primary focus:border-brand focus:outline-none"
                  @change="
                    handleFromHourChange(
                      slot,
                      ($event.target as HTMLSelectElement).value
                    )
                  "
                >
                  <option v-for="h in FROM_HOURS" :key="h" :value="h">
                    {{ formatHour(h) }}
                  </option>
                </select>
              </label>

              <label class="flex items-center gap-1.5">
                <span class="text-text-secondary">{{ t("settings_to") }}</span>
                <select
                  :value="slot.to_hour"
                  class="rounded-md border border-border bg-surface px-2 py-1 font-condensed text-xs font-bold text-text-primary focus:border-brand focus:outline-none"
                  @change="
                    handleToHourChange(
                      slot,
                      ($event.target as HTMLSelectElement).value
                    )
                  "
                >
                  <option
                    v-for="h in getToHoursForSlot(slot.from_hour)"
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
                  :value="slot.interval_minutes"
                  class="rounded-md border border-border bg-surface px-2 py-1 font-condensed text-xs font-bold text-brand focus:border-brand focus:outline-none"
                  @change="
                    handleIntervalChange(
                      slot,
                      ($event.target as HTMLSelectElement).value
                    )
                  "
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
              title="Удалить интервал"
              @click="removeIntervalFromActiveDay(slot.id)"
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
                class="rounded-lg border px-2.5 py-2 text-center text-[11px] font-bold uppercase transition"
                :class="
                  slot.discipline === disc
                    ? 'border-brand bg-brand/15 text-brand'
                    : 'border-border bg-surface text-text-secondary hover:border-border-hover'
                "
                @click="selectSlotDiscipline(slot, disc)"
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
                class="flex flex-col items-center rounded-lg border py-1.5 text-center transition"
                :class="
                  slot.difficulty === diff
                    ? 'border-brand bg-brand/15 text-brand'
                    : 'border-border bg-surface text-text-secondary hover:border-border-hover'
                "
                @click="slot.difficulty = diff"
              >
                <span class="text-xs font-bold">{{ difficultyTitle(diff) }}</span>
                <span class="text-[10px] opacity-80">MOZERO</span>
              </button>
            </div>
          </div>

          <!-- Row 4: Focus / Theme Tile for this Interval's Discipline -->
          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-bold tracking-wider text-text-secondary uppercase">
              {{ t("settings_slot_focus") }} ({{ disciplineTitle(slot.discipline) }})
            </span>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="tile in getWarmupTilesForDiscipline(slot.discipline)"
                :key="tile.id"
                type="button"
                class="rounded-md border px-2.5 py-1 text-xs font-semibold transition"
                :class="
                  isSlotTileSelected(slot, tile)
                    ? 'border-brand bg-brand/15 text-brand font-bold'
                    : 'border-border bg-surface text-text-secondary hover:border-border-hover'
                "
                @click="selectSlotFocusTile(slot, tile)"
              >
                {{ getWarmupTileLabel(tile, lang) }}
              </button>
            </div>
          </div>
        </div>

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
    </section>

    <!-- Bot Language -->
    <section class="glass flex flex-wrap items-center justify-between gap-3 p-4">
      <span class="text-xs font-bold tracking-wider text-text-secondary uppercase">
        {{ t("settings_bot_language") }}
      </span>
      <div class="flex items-center gap-2">
        <button
          v-for="l in ['ru', 'en', 'de'] as const"
          :key="l"
          type="button"
          class="rounded-md border px-3.5 py-1.5 text-xs font-bold uppercase transition"
          :class="
            clubLanguage === l
              ? 'border-brand bg-brand/15 text-brand'
              : 'border-border bg-elevated text-text-secondary'
          "
          @click="clubLanguage = l"
        >
          {{ l }}
        </button>
      </div>
    </section>

    <!-- Save & Publish Now Buttons -->
    <div class="flex flex-col gap-2 sm:flex-row">
      <button
        type="button"
        :disabled="!isDirty || isSaving"
        class="flex-1 rounded-lg border py-3 text-sm font-bold transition"
        :class="
          isDirty
            ? 'border-brand bg-brand/15 text-brand hover:bg-brand hover:text-on-brand'
            : 'border-border bg-elevated text-text-secondary opacity-60 cursor-default'
        "
        @click="saveSettings"
      >
        {{
          isDirty
            ? t("settings_save_active_btn")
            : t("settings_saved_passive_btn")
        }}
      </button>

      <button
        type="button"
        :disabled="isPublishing || club?.status === 'blocked'"
        class="flex-1 rounded-lg bg-brand py-3 text-sm font-bold text-on-brand transition hover:bg-brand-deep disabled:opacity-50"
        @click="publishChallengeNow"
      >
        {{ t("settings_publish_now_btn") }}
      </button>
    </div>

    <!-- Moderator Disconnect & Purge All Club Data -->
    <section
      v-if="club"
      class="glass flex flex-col gap-2.5 border border-danger/30 p-4"
    >
      <div class="text-xs font-bold tracking-wider text-danger uppercase">
        {{ t("settings_disconnect_zone_title") }}
      </div>
      <p class="text-xs text-text-secondary">
        {{ t("settings_disconnect_zone_desc") }}
      </p>
      <button
        type="button"
        :disabled="isDisconnecting"
        class="w-full rounded-lg border border-danger/50 bg-danger/15 py-2.5 text-xs font-bold text-danger transition hover:bg-danger hover:text-on-brand disabled:opacity-50"
        @click="disconnectAndPurgeClub"
      >
        {{ t("settings_disconnect_btn") }}
      </button>
    </section>
  </div>
</template>
