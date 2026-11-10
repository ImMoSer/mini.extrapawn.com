<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  ALL_CHALLENGE_DISCIPLINES,
  DEFAULT_CLUB_INVITE_URL,
  type ChallengeDiscipline,
} from "shared";
import { useCabinetStore } from "@/entities/cabinet/model/cabinet.store";
import { useI18n } from "@/shared/i18n/useI18n";
import { openTelegramUrl } from "@/shared/lib/telegram";

const router = useRouter();
const cabinetStore = useCabinetStore();
const { t, disciplineTitle } = useI18n();

const termsAccepted = ref(false);

const addBotDeepLink = computed(() => {
  const botUsername = cabinetStore.data?.bot_username || "ExtraPawnTeleBot";
  return `https://t.me/${botUsername}?startgroup=true&admin=manage_topics+post_messages+pin_messages`;
});

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
  if (!termsAccepted.value) return;
  openTelegramUrl(addBotDeepLink.value);
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
              SUPERADMIN
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

    <!-- 4 Discipline Stats Cards (Attempts, Solved, Failed across all difficulties) -->
    <section class="flex flex-col gap-2">
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

    <!-- Connected Chess Clubs -->
    <section class="flex flex-col gap-2">
      <h2 class="px-1 text-xs font-bold tracking-wider text-text-secondary uppercase">
        {{ t("cabinet_clubs_title") }}
      </h2>

      <div class="flex flex-col gap-2">
        <div
          v-for="club in cabinetStore.clubs"
          :key="club.chat_id"
          class="glass flex flex-wrap items-center justify-between gap-3 p-3.5"
        >
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-2">
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
            </div>
            <span class="text-xs text-text-secondary">
              Topic #{{ club.topic_thread_id }} •
              {{ club.published_challenges_count }} challenges
            </span>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-border bg-elevated px-3 py-1.5 text-xs font-bold text-text-primary transition hover:border-brand hover:text-brand"
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
              v-if="club.is_admin"
              type="button"
              class="rounded-md bg-brand px-3 py-1.5 text-xs font-bold text-on-brand transition hover:bg-brand-deep"
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
    </section>
  </div>
</template>

