<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ALL_DAYS_OF_WEEK,
  CLUB_TIMEZONE_OPTIONS,
  createDefaultWeeklySchedule,
  getClubTimezoneOptionLabel,
  normalizeWeeklySchedule,
  type AppLanguage,
  type ChallengeDiscipline,
  type ClubSummaryDTO,
  type DayOfWeekKey,
  type WeeklyScheduleConfig,
} from "shared";
import { useCabinetStore } from "@/entities/cabinet/model/cabinet.store";
import ClubDayScheduleEditor from "@/pages/club-settings/ui/ClubDayScheduleEditor.vue";
import ClubSettingsHeaderCard from "@/pages/club-settings/ui/ClubSettingsHeaderCard.vue";
import { apiRequest } from "@/shared/api/httpClient";
import { useI18n } from "@/shared/i18n/useI18n";

const route = useRoute();
const router = useRouter();
const cabinetStore = useCabinetStore();
const { lang, t } = useI18n();

const chatId = computed(() => String(route.params.chatId || ""));

function detectTodayKey(): DayOfWeekKey {
  const jsDay = new Date().getDay();
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

async function toggleMasterActive() {
  if (isTogglingActive.value || !club.value) return;
  isTogglingActive.value = true;
  statusBanner.value = null;
  try {
    const nextVal = !isClubActive.value;
    const updated = await apiRequest<ClubSummaryDTO>(
      `/clubs/${encodeURIComponent(chatId.value)}/active`,
      {
        method: "PATCH",
        body: JSON.stringify({ is_active: nextVal }),
      }
    );
    club.value = updated;
    isClubActive.value = updated.is_active;
    await cabinetStore.fetchCabinet();
  } catch (err) {
    statusBanner.value = {
      type: "error",
      text: err instanceof Error ? err.message : String(err),
    };
  } finally {
    isTogglingActive.value = false;
  }
}

async function loadClub() {
  isLoading.value = true;
  try {
    if (!cabinetStore.data) {
      await cabinetStore.fetchCabinet();
    }
    const res = await apiRequest<ClubSummaryDTO>(
      `/clubs/${encodeURIComponent(chatId.value)}`
    );
    if (!res.is_admin && !cabinetStore.isSuperadmin) {
      await router.replace("/clubs");
      return;
    }
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
      text: t("settings_err_overlap"),
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
    <ClubSettingsHeaderCard
      v-if="club"
      :club="club"
      :is-club-active="isClubActive"
      :is-toggling-active="isTogglingActive"
      @back="router.push('/cabinet')"
      @toggle-active="toggleMasterActive"
    />

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
        <span class="font-condensed text-[11px] font-bold text-brand">
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

      <ClubDayScheduleEditor
        v-model:weekly-schedule="weeklySchedule"
        v-model:active-day="activeDay"
        @copied-notice="(msg) => (statusBanner = { type: 'success', text: msg })"
      />
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
        class="min-w-0 flex-1 truncate rounded-lg border px-3 py-3 text-sm font-bold transition"
        :class="
          isDirty
            ? 'border-brand bg-brand/15 text-brand hover:bg-brand hover:text-on-brand'
            : 'cursor-default border-border bg-elevated text-text-secondary opacity-60'
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
        :disabled="
          isPublishing ||
          club?.status === 'blocked' ||
          club?.status === 'pending'
        "
        class="min-w-0 flex-1 truncate rounded-lg bg-brand px-3 py-3 text-sm font-bold text-on-brand transition hover:bg-brand-deep disabled:opacity-50"
        @click="publishChallengeNow"
      >
        {{ t("settings_publish_now_btn") }}
      </button>
    </div>

    <!-- SuperAdmin Only: Disconnect & Purge All Club Data -->
    <section
      v-if="club && cabinetStore.isSuperadmin"
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
        class="w-full truncate rounded-lg border border-danger/50 bg-danger/15 px-3 py-2.5 text-xs font-bold text-danger transition hover:bg-danger hover:text-on-brand disabled:opacity-50"
        @click="disconnectAndPurgeClub"
      >
        {{ t("settings_disconnect_btn") }}
      </button>
    </section>
  </div>
</template>
