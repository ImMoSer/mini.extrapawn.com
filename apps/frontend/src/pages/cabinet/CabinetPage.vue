<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  ALL_CHALLENGE_DISCIPLINES,
  DEFAULT_CLUB_INVITE_URL,
  type ChallengeDiscipline,
  type ClubSummaryDTO,
} from "shared";
import { useCabinetStore } from "@/entities/cabinet/model/cabinet.store";
import { useI18n } from "@/shared/i18n/useI18n";
import { openTelegramUrl } from "@/shared/lib/telegram";

const router = useRouter();
const cabinetStore = useCabinetStore();
const { t, disciplineTitle } = useI18n();

const activeTab = ref<"stats" | "my_clubs">("stats");
const termsAccepted = ref(false);
const togglingChatId = ref<string | null>(null);

const addBotDeepLink = computed(() => {
  const botUsername = cabinetStore.data?.bot_username || "ExtraPawnTeleBot";
  return `https://t.me/${botUsername}?startgroup=true&admin=manage_topics+post_messages+pin_messages`;
});

const isClubLimitReached = computed(
  () =>
    !cabinetStore.isSuperadmin &&
    cabinetStore.ownedClubsCount >= cabinetStore.maxOwnedClubs
);

function getStatsForDiscipline(d: ChallengeDiscipline) {
  return (
    cabinetStore.data?.stats[d] ?? {
      discipline: d,
      total_attempts: 0,
      solved_count: 0,
      failed_count: 0,
      total_points: 0,
      total_time_ms: 0,
    }
  );
}

function handleAddBotToGroup() {
  if (!termsAccepted.value || isClubLimitReached.value) return;
  openTelegramUrl(addBotDeepLink.value);
}

async function handleToggleClub(club: ClubSummaryDTO) {
  if (togglingChatId.value) return;
  togglingChatId.value = club.chat_id;
  try {
    await cabinetStore.toggleClubActive(club.chat_id, !club.is_active);
  } finally {
    togglingChatId.value = null;
  }
}

onMounted(() => {
  void cabinetStore.fetchCabinet();
});
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4 px-3 py-4">
    <!-- User Profile Header -->
    <section class="glass flex flex-wrap items-center justify-between gap-3 p-4">
      <div class="flex items-center gap-3">
        <div
          class="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-elevated text-lg font-bold text-brand"
        >
          {{
            cabinetStore.currentUser?.first_name
              ? cabinetStore.currentUser.first_name.slice(0, 1).toUpperCase()
              : "♟"
          }}
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-base font-bold text-text-primary">
              {{ cabinetStore.currentUser?.first_name || "Chess Player" }}
            </h1>
            <span
              v-if="cabinetStore.isSuperadmin"
              class="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-bold tracking-wider text-accent uppercase"
            >
              BOSS
            </span>
          </div>
          <p class="text-xs text-text-secondary">
            {{
              cabinetStore.currentUser?.username
                ? `@${cabinetStore.currentUser.username}`
                : `ID: ${cabinetStore.currentUser?.telegram_id ?? "..."}`
            }}
          </p>
        </div>
      </div>

      <button
        type="button"
        class="rounded-lg border border-brand/40 bg-elevated px-3 py-2 text-xs font-bold text-brand transition hover:border-brand"
        @click="openTelegramUrl(DEFAULT_CLUB_INVITE_URL)"
      >
        💬 {{ t("cabinet_join_default_club") }}
      </button>
    </section>

    <!-- Internal Switcher: 📊 Статистика | ⚙️ Мои клубы -->
    <div class="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-1.5">
      <button
        type="button"
        class="rounded-lg py-2 text-xs font-bold transition"
        :class="
          activeTab === 'stats'
            ? 'bg-brand text-on-brand'
            : 'text-text-secondary hover:text-text-primary'
        "
        @click="activeTab = 'stats'"
      >
        {{ t("cabinet_tab_stats") }}
      </button>

      <button
        type="button"
        class="rounded-lg py-2 text-xs font-bold transition"
        :class="
          activeTab === 'my_clubs'
            ? 'bg-brand text-on-brand'
            : 'text-text-secondary hover:text-text-primary'
        "
        @click="activeTab = 'my_clubs'"
      >
        {{ t("cabinet_tab_my_clubs") }}
        <span class="ml-1 font-condensed opacity-90">
          ({{
            cabinetStore.isSuperadmin
              ? cabinetStore.myClubs.length
              : `${cabinetStore.ownedClubsCount}/${cabinetStore.maxOwnedClubs}`
          }})
        </span>
      </button>
    </div>

    <!-- TAB 1: 4 Discipline Stats Cards -->
    <section v-if="activeTab === 'stats'" class="flex flex-col gap-2">
      <h2 class="px-1 text-xs font-bold tracking-wider text-text-secondary uppercase">
        {{ t("cabinet_my_stats") }}
      </h2>

      <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div
          v-for="disc in ALL_CHALLENGE_DISCIPLINES"
          :key="disc"
          class="glass flex flex-col justify-between gap-3 p-3.5"
        >
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold tracking-wider text-text-secondary uppercase">
              {{ disciplineTitle(disc) }}
            </span>
            <span
              class="rounded border border-border bg-elevated px-2 py-0.5 font-condensed text-xs font-bold text-brand"
            >
              {{ getStatsForDiscipline(disc).total_points }} PTS
            </span>
          </div>

          <div class="grid grid-cols-3 gap-2 pt-1">
            <div class="rounded-md bg-elevated px-2.5 py-2">
              <div class="text-[11px] text-text-secondary">
                {{ t("stats_attempts") }}
              </div>
              <div class="font-condensed text-lg font-bold text-text-primary">
                {{ getStatsForDiscipline(disc).total_attempts }}
              </div>
            </div>

            <div class="rounded-md bg-elevated px-2.5 py-2">
              <div class="text-[11px] text-text-secondary">
                {{ t("stats_solved") }}
              </div>
              <div class="font-condensed text-lg font-bold text-success">
                {{ getStatsForDiscipline(disc).solved_count }}
              </div>
            </div>

            <div class="rounded-md bg-elevated px-2.5 py-2">
              <div class="text-[11px] text-text-secondary">
                {{ t("stats_failed") }}
              </div>
              <div class="font-condensed text-lg font-bold text-danger">
                {{ getStatsForDiscipline(disc).failed_count }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- TAB 2: My Clubs & Bot Onboarding -->
    <template v-else>
      <section class="flex flex-col gap-2.5">
        <div class="flex items-center justify-between px-1">
          <h2 class="text-xs font-bold tracking-wider text-text-secondary uppercase">
            {{ t("cabinet_tab_my_clubs") }}
          </h2>
          <span
            v-if="!cabinetStore.isSuperadmin"
            class="font-condensed text-xs font-bold text-text-secondary"
          >
            {{ cabinetStore.ownedClubsCount }} / {{ cabinetStore.maxOwnedClubs }}
          </span>
        </div>

        <div
          v-if="!cabinetStore.myClubs.length"
          class="glass p-5 text-center text-xs text-text-secondary"
        >
          {{ t("cabinet_my_clubs_empty") }}
        </div>

        <div
          v-for="club in cabinetStore.myClubs"
          :key="club.chat_id"
          class="glass flex flex-col gap-3 p-3.5"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="flex flex-col gap-0.5">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="text-sm font-bold text-text-primary">
                  {{ club.title }}
                </span>
                <span
                  v-if="club.is_default"
                  class="rounded bg-brand/20 px-1.5 py-0.5 text-[10px] font-bold text-brand uppercase"
                >
                  DEFAULT
                </span>
                <span
                  v-if="club.status === 'blocked'"
                  class="rounded bg-danger/20 px-1.5 py-0.5 text-[10px] font-bold text-danger uppercase"
                >
                  BLOCKED
                </span>
                <span
                  v-else-if="club.auto_paused && club.is_active"
                  class="rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold text-warning uppercase"
                >
                  AUTO-PAUSE
                </span>
              </div>
              <span class="text-xs text-text-secondary">
                Topic #{{ club.topic_thread_id }} •
                {{ club.published_challenges_count }} challenges
              </span>
            </div>

            <!-- Quick Active Toggle -->
            <button
              v-if="club.status !== 'blocked'"
              type="button"
              :disabled="togglingChatId === club.chat_id"
              class="flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-bold transition"
              :class="
                club.is_active
                  ? 'border-brand/50 bg-brand/15 text-brand'
                  : 'border-border bg-elevated text-text-secondary'
              "
              @click="handleToggleClub(club)"
            >
              <span
                class="h-2.5 w-2.5 rounded-full transition"
                :class="club.is_active ? 'bg-brand' : 'bg-text-disabled'"
              ></span>
              <span>
                {{
                  club.is_active
                    ? t("settings_bot_active")
                    : t("settings_bot_paused")
                }}
              </span>
            </button>
          </div>

          <div class="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
            <button
              type="button"
              class="flex-1 rounded-md border border-border bg-elevated px-3 py-1.5 text-xs font-bold text-text-primary transition hover:border-brand hover:text-brand"
              @click="
                cabinetStore.selectedChatId = club.chat_id;
                router.push(
                  `/challenge/records/${encodeURIComponent(club.chat_id)}`
                );
              "
            >
              🏆 {{ t("cabinet_open_records") }}
            </button>

            <button
              type="button"
              class="flex-1 rounded-md bg-brand px-3 py-1.5 text-xs font-bold text-on-brand transition hover:bg-brand-deep"
              @click="
                cabinetStore.selectedChatId = club.chat_id;
                router.push(
                  `/club-settings/${encodeURIComponent(club.chat_id)}`
                );
              "
            >
              ⚙️ {{ t("cabinet_open_settings") }}
            </button>
          </div>
        </div>
      </section>

      <!-- 1-Click Add Bot to Supergroup Onboarding -->
      <section class="glass flex flex-col gap-3 p-4">
        <div class="flex flex-col gap-1">
          <h2 class="text-xs font-bold tracking-wider text-brand uppercase">
            {{ t("cabinet_add_bot_title") }}
          </h2>
          <p class="text-xs leading-relaxed text-text-secondary">
            {{ t("cabinet_add_bot_desc") }}
          </p>
        </div>

        <div
          v-if="isClubLimitReached"
          class="rounded-lg border border-warning/40 bg-warning/15 p-3 text-xs font-semibold text-warning"
        >
          ⚠️ {{ t("cabinet_limit_reached") }}
        </div>

        <template v-else>
          <label
            class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-elevated p-3 text-xs text-text-secondary"
          >
            <input
              v-model="termsAccepted"
              type="checkbox"
              class="mt-0.5 h-4 w-4 accent-brand"
            />
            <span>{{ t("cabinet_terms_checkbox") }}</span>
          </label>

          <button
            type="button"
            :disabled="!termsAccepted"
            class="w-full rounded-lg py-2.5 text-sm font-bold transition"
            :class="
              termsAccepted
                ? 'bg-brand text-on-brand hover:bg-brand-deep cursor-pointer'
                : 'bg-elevated text-text-disabled cursor-not-allowed border border-border'
            "
            @click="handleAddBotToGroup"
          >
            {{ t("cabinet_add_bot_btn") }}
          </button>
        </template>
      </section>
    </template>
  </div>
</template>

