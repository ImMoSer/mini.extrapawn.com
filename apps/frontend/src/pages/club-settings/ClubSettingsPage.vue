<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ALL_CHALLENGE_DIFFICULTIES,
  ALL_CHALLENGE_DISCIPLINES,
  DEFAULT_CLUB_CHAT_ID,
  PRACTICAL_WARMUP_TILES,
  TACTICS_WARMUP_TILES,
  THEORETICAL_WARMUP_TILES,
  type AppLanguage,
  type ChallengeDifficulty,
  type ChallengeDiscipline,
  type ClubSummaryDTO,
  type WarmupFocusTile,
} from "shared";
import { apiRequest } from "@/shared/api/httpClient";
import { useI18n } from "@/shared/i18n/useI18n";

const route = useRoute();
const router = useRouter();
const { lang, t, disciplineTitle, difficultyTitle } = useI18n();

const chatId = computed(() =>
  route.params.chatId ? String(route.params.chatId) : DEFAULT_CLUB_CHAT_ID
);

const club = ref<ClubSummaryDTO | null>(null);
const isLoading = ref(false);
const isSaving = ref(false);
const isPublishing = ref(false);
const statusBanner = ref<string | null>(null);

// Editable settings state
const selectedDisciplines = ref<ChallengeDiscipline[]>(["tactics"]);
const activePreviewDiscipline = ref<ChallengeDiscipline>("tactics");
const selectedDifficulties = ref<ChallengeDifficulty[]>(["Novice", "Pro"]);
const selectedFocusGroup = ref<string>("all");
const selectedFocusKeys = ref<string[]>(["all"]);
const selectedObjective = ref<string>("all");
const scheduleTimes = ref<string[]>(["09:00", "15:00", "20:00"]);
const clubLanguage = ref<AppLanguage>("ru");
const clubTimezone = ref<string>("Europe/Berlin");

const AVAILABLE_HOURS = [
  "08:00",
  "09:00",
  "11:00",
  "13:00",
  "15:00",
  "17:00",
  "19:00",
  "20:00",
  "21:00",
  "22:00",
];

const focusTilesForActiveDiscipline = computed<readonly WarmupFocusTile[]>(() => {
  if (activePreviewDiscipline.value === "tactics") {
    return TACTICS_WARMUP_TILES;
  }
  if (activePreviewDiscipline.value === "theoretical_endgames") {
    return THEORETICAL_WARMUP_TILES;
  }
  return PRACTICAL_WARMUP_TILES;
});

function toggleDiscipline(d: ChallengeDiscipline) {
  activePreviewDiscipline.value = d;
  const idx = selectedDisciplines.value.indexOf(d);
  if (idx >= 0) {
    if (selectedDisciplines.value.length > 1) {
      selectedDisciplines.value.splice(idx, 1);
    }
  } else {
    selectedDisciplines.value.push(d);
  }
}

function toggleDifficulty(diff: ChallengeDifficulty) {
  const idx = selectedDifficulties.value.indexOf(diff);
  if (idx >= 0) {
    if (selectedDifficulties.value.length > 1) {
      selectedDifficulties.value.splice(idx, 1);
    }
  } else {
    selectedDifficulties.value.push(diff);
  }
}

function selectFocusTile(tile: WarmupFocusTile) {
  if (tile.id === "mix") {
    selectedFocusGroup.value = "all";
    selectedFocusKeys.value = ["all"];
    selectedObjective.value = "all";
    return;
  }

  if (tile.focusGroup === "objective") {
    selectedObjective.value = tile.focusKey;
    selectedFocusGroup.value = "objective";
    selectedFocusKeys.value = [tile.focusKey];
    return;
  }

  selectedFocusGroup.value = tile.focusGroup;
  selectedFocusKeys.value = [tile.focusKey];
}

function isTileSelected(tile: WarmupFocusTile): boolean {
  if (tile.id === "mix") {
    return selectedFocusKeys.value.includes("all");
  }
  return selectedFocusKeys.value.includes(tile.focusKey);
}

function toggleScheduleHour(hhmm: string) {
  const idx = scheduleTimes.value.indexOf(hhmm);
  if (idx >= 0) {
    if (scheduleTimes.value.length > 1) {
      scheduleTimes.value.splice(idx, 1);
    }
  } else {
    scheduleTimes.value.push(hhmm);
    scheduleTimes.value.sort();
  }
}

async function loadClub() {
  isLoading.value = true;
  try {
    const res = await apiRequest<ClubSummaryDTO>(
      `/clubs/${encodeURIComponent(chatId.value)}`
    );
    club.value = res;
    selectedDisciplines.value = [...res.filter_disciplines];
    activePreviewDiscipline.value = res.filter_disciplines[0] || "tactics";
    selectedDifficulties.value = [...res.filter_difficulties];
    selectedFocusGroup.value = res.filter_focus_group || "all";
    selectedFocusKeys.value = [...res.filter_focus_keys];
    selectedObjective.value = res.filter_objective || "all";
    scheduleTimes.value = [...res.schedule_times];
    clubLanguage.value = res.language || "ru";
    clubTimezone.value = res.timezone || "Europe/Berlin";
  } finally {
    isLoading.value = false;
  }
}

async function saveSettings() {
  isSaving.value = true;
  statusBanner.value = null;
  try {
    const updated = await apiRequest<ClubSummaryDTO>(
      `/clubs/${encodeURIComponent(chatId.value)}/settings`,
      {
        method: "PUT",
        body: JSON.stringify({
          language: clubLanguage.value,
          timezone: clubTimezone.value,
          schedule_times: scheduleTimes.value,
          leaderboard_cron_days: club.value?.leaderboard_cron_days ?? 3,
          filter_disciplines: selectedDisciplines.value,
          filter_difficulties: selectedDifficulties.value,
          filter_focus_group: selectedFocusGroup.value,
          filter_focus_keys: selectedFocusKeys.value,
          filter_objective: selectedObjective.value,
        }),
      }
    );
    club.value = updated;
    statusBanner.value = t("settings_saved_ok");
  } finally {
    isSaving.value = false;
  }
}

async function publishChallengeNow() {
  isPublishing.value = true;
  statusBanner.value = null;
  try {
    await saveSettings();
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
      body: JSON.stringify({
        discipline: activePreviewDiscipline.value,
        difficulty: selectedDifficulties.value[0] || "Novice",
      }),
    });
    statusBanner.value = "Челлендж опубликован в теме клуба!";
    if (res.challenge) {
      await router.push(
        `/challenge/${res.challenge.discipline}/${encodeURIComponent(
          res.challenge.puzzleId
        )}/${encodeURIComponent(
          res.challenge.edition
        )}/${encodeURIComponent(res.challenge.chatId)}`
      );
    }
  } finally {
    isPublishing.value = false;
  }
}

onMounted(() => {
  void loadClub();
});
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4 px-3 py-4">
    <!-- Club Settings Header -->
    <section
      v-if="club"
      class="glass flex flex-wrap items-center justify-between gap-2 p-4"
    >
      <div>
        <div class="text-xs font-bold tracking-wider text-brand uppercase">
          {{ t("settings_title") }}
        </div>
        <h1 class="mt-0.5 text-base font-bold text-text-primary">
          {{ club.title }} (Topic #{{ club.topic_thread_id }})
        </h1>
      </div>

      <span class="rounded border border-border bg-elevated px-2.5 py-1 text-xs font-bold text-brand uppercase">
        {{ club.status }}
      </span>
    </section>

    <div
      v-if="statusBanner"
      class="rounded-lg border border-success/40 bg-success/15 px-3 py-2 text-xs font-bold text-success"
    >
      {{ statusBanner }}
    </div>

    <!-- 1. Disciplines Grid (WarmUp Top Cards Style) -->
    <section class="glass flex flex-col gap-3 p-4">
      <h2 class="text-xs font-bold tracking-wider text-text-secondary uppercase">
        {{ t("settings_step_1") }}
      </h2>

      <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <button
          v-for="disc in ALL_CHALLENGE_DISCIPLINES"
          :key="disc"
          type="button"
          class="flex items-center justify-between rounded-lg border p-3.5 text-left transition"
          :class="
            selectedDisciplines.includes(disc)
              ? 'border-brand bg-elevated text-text-primary'
              : 'border-border bg-surface text-text-secondary hover:border-border-hover'
          "
          @click="toggleDiscipline(disc)"
        >
          <span class="text-xs font-bold tracking-wider uppercase">
            {{ disciplineTitle(disc) }}
          </span>
          <span
            class="rounded px-2 py-0.5 text-[10px] font-bold uppercase"
            :class="
              selectedDisciplines.includes(disc)
                ? 'bg-brand text-on-brand'
                : 'bg-surface text-text-disabled border border-border'
            "
          >
            {{ selectedDisciplines.includes(disc) ? "ON" : "OFF" }}
          </span>
        </button>
      </div>
    </section>

    <!-- 2. Difficulty & 3. WarmUp Focus Tiles (Matching WarmUp Screenshots) -->
    <section class="glass flex flex-col gap-4 p-4">
      <!-- Difficulty Cards -->
      <div class="flex flex-col gap-2">
        <h2 class="text-xs font-bold tracking-wider text-text-secondary uppercase">
          {{ t("settings_step_2") }}
        </h2>

        <div class="grid grid-cols-3 gap-2.5">
          <button
            v-for="diff in ALL_CHALLENGE_DIFFICULTIES"
            :key="diff"
            type="button"
            class="flex flex-col gap-1 rounded-lg border p-3 text-left transition"
            :class="
              selectedDifficulties.includes(diff)
                ? 'border-brand bg-elevated text-text-primary'
                : 'border-border bg-surface text-text-secondary hover:border-border-hover'
            "
            @click="toggleDifficulty(diff)"
          >
            <span class="text-sm font-bold">
              {{ difficultyTitle(diff) }}
            </span>
            <span class="text-[11px] text-text-secondary">
              {{
                activePreviewDiscipline === "theoretical_endgames"
                  ? "MOZERO"
                  : diff === "Novice"
                    ? "Maia 1500"
                    : diff === "Pro"
                      ? "Maia 2200"
                      : "MOZERO"
              }}
            </span>
          </button>
        </div>
      </div>

      <!-- WarmUp Focus Tiles -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <h2 class="text-xs font-bold tracking-wider text-text-secondary uppercase">
            {{ t("settings_step_3") }} ({{
              disciplineTitle(activePreviewDiscipline)
            }})
          </h2>
        </div>

        <!-- Full-width MIX Button -->
        <button
          v-if="focusTilesForActiveDiscipline[0]"
          type="button"
          class="w-full rounded-lg border py-2.5 text-center text-xs font-bold tracking-wider uppercase transition"
          :class="
            isTileSelected(focusTilesForActiveDiscipline[0])
              ? 'border-brand bg-elevated text-brand'
              : 'border-border bg-surface text-text-secondary hover:border-border-hover'
          "
          @click="selectFocusTile(focusTilesForActiveDiscipline[0])"
        >
          MIX
        </button>

        <!-- Sub-tiles Grid -->
        <div
          class="grid gap-2"
          :class="
            activePreviewDiscipline === 'tactics'
              ? 'grid-cols-3'
              : 'grid-cols-2'
          "
        >
          <button
            v-for="tile in focusTilesForActiveDiscipline.slice(1)"
            :key="tile.id"
            type="button"
            class="rounded-lg border py-2.5 text-center text-xs font-semibold transition"
            :class="[
              tile.id === 'extra' ? 'col-span-2 font-bold text-brand' : '',
              isTileSelected(tile)
                ? 'border-brand bg-elevated text-brand'
                : 'border-border bg-surface text-text-secondary hover:border-border-hover',
            ]"
            @click="selectFocusTile(tile)"
          >
            {{ lang === "en" ? tile.labelEn : tile.labelRu }}
          </button>
        </div>
      </div>
    </section>

    <!-- 4. Schedule Times & Language -->
    <section class="glass flex flex-col gap-3 p-4">
      <h2 class="text-xs font-bold tracking-wider text-text-secondary uppercase">
        {{ t("settings_step_4") }}
      </h2>

      <div class="flex flex-wrap gap-2">
        <button
          v-for="hhmm in AVAILABLE_HOURS"
          :key="hhmm"
          type="button"
          class="rounded-md border px-2.5 py-1.5 font-condensed text-xs font-bold transition"
          :class="
            scheduleTimes.includes(hhmm)
              ? 'border-brand bg-elevated text-brand'
              : 'border-border bg-surface text-text-secondary'
          "
          @click="toggleScheduleHour(hhmm)"
        >
          {{ hhmm }}
        </button>
      </div>

      <div class="flex items-center gap-3 pt-1">
        <span class="text-xs text-text-secondary">Язык постов бота:</span>
        <button
          v-for="l in ['ru', 'en'] as const"
          :key="l"
          type="button"
          class="rounded-md border px-3 py-1 text-xs font-bold uppercase"
          :class="
            clubLanguage === l
              ? 'border-brand bg-elevated text-brand'
              : 'border-border bg-surface text-text-secondary'
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
        :disabled="isSaving"
        class="flex-1 rounded-lg border border-brand bg-elevated py-3 text-sm font-bold text-brand transition hover:bg-brand hover:text-on-brand"
        @click="saveSettings"
      >
        💾 {{ t("settings_save_btn") }}
      </button>

      <button
        type="button"
        :disabled="isPublishing"
        class="flex-1 rounded-lg bg-brand py-3 text-sm font-bold text-on-brand transition hover:bg-brand-deep"
        @click="publishChallengeNow"
      >
        {{ t("settings_publish_now_btn") }}
      </button>
    </div>
  </div>
</template>

