<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  ALL_CHALLENGE_DISCIPLINES,
  getOfficialClubInviteUrl,
  type ChallengeDiscipline,
  type UserChallengeHistoryItemDTO,
} from "shared";
import { useCabinetStore } from "@/entities/cabinet/model/cabinet.store";
import { useI18n } from "@/shared/i18n/useI18n";
import { openTelegramUrl } from "@/shared/lib/telegram";

const router = useRouter();
const cabinetStore = useCabinetStore();
const { lang, t, disciplineTitle, difficultyTitle, focusTitle } = useI18n();

const activeTab = ref<"stats" | "history">("stats");

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

function formatBestSeconds(ms: number | null): string {
  if (ms === null || ms === undefined) return "";
  return (Math.round((ms / 1000) * 10) / 10).toFixed(1);
}

function formatPoints(pts: number): string {
  if (Number.isInteger(pts)) return String(pts);
  return pts.toFixed(2).replace(/\.?0+$/, "");
}

function openHistoryChallenge(item: UserChallengeHistoryItemDTO) {
  void router.push(
    `/challenge/${item.discipline}/${encodeURIComponent(
      item.puzzle_id
    )}/${encodeURIComponent(item.edition)}/${encodeURIComponent(item.chat_id)}`
  );
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
        @click="openTelegramUrl(getOfficialClubInviteUrl(lang))"
      >
        💬 {{ t("cabinet_join_default_club") }}
      </button>
    </section>

    <!-- Internal Switcher: 📊 Статистика | 📜 История -->
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
          activeTab === 'history'
            ? 'bg-brand text-on-brand'
            : 'text-text-secondary hover:text-text-primary'
        "
        @click="activeTab = 'history'"
      >
        {{ t("cabinet_tab_history") }}
        <span class="ml-1 font-condensed opacity-90">
          ({{ cabinetStore.history.length }})
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

    <!-- TAB 2: Global Challenge History Across All Clubs -->
    <section v-else class="glass flex flex-col gap-3 p-3.5">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-xs font-bold tracking-wider text-text-secondary uppercase">
          {{ t("cabinet_history_title") }}
        </h2>
        <span class="rounded bg-elevated px-2 py-0.5 font-condensed text-xs font-bold text-text-secondary">
          {{ cabinetStore.history.length }}
        </span>
      </div>

      <div
        v-if="!cabinetStore.history.length"
        class="rounded-lg border border-border bg-elevated/60 py-6 text-center text-xs text-text-secondary"
      >
        {{ t("cabinet_history_empty") }}
      </div>

      <div v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          v-for="item in cabinetStore.history"
          :key="`${item.chat_id}-${item.discipline}-${item.puzzle_id}-${item.edition}`"
          type="button"
          class="flex flex-col justify-between gap-2 rounded-lg border bg-elevated p-3 text-left text-xs transition"
          :class="
            item.my_status === 'solved'
              ? 'border-accent/35 hover:border-accent'
              : 'border-danger/35 hover:border-danger'
          "
          @click="openHistoryChallenge(item)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="truncate rounded bg-surface px-1.5 py-0.5 text-[10px] font-bold text-brand">
                  🏆 {{ item.club_title }}
                </span>
                <span class="font-bold text-text-primary">
                  {{ disciplineTitle(item.discipline) }}
                </span>
              </div>
              <div class="mt-0.5 text-[11px] text-text-secondary">
                <span class="font-semibold text-text-primary/90">
                  {{ focusTitle(item.discipline, item.category) }}
                </span>
                <span> • {{ difficultyTitle(item.difficulty) }}</span>
              </div>
            </div>

            <!-- Violet badge for Solved / Reddish badge for Surrendered -->
            <span
              v-if="item.my_status === 'solved'"
              class="shrink-0 rounded-md border border-accent/40 bg-accent/15 px-2 py-0.5 font-condensed text-[11px] font-bold text-accent"
            >
              {{ t("records_badge_solved") }} (+{{ formatPoints(item.my_points) }} PTS)
            </span>
            <span
              v-else
              class="shrink-0 rounded-md border border-danger/40 bg-danger/15 px-2 py-0.5 font-condensed text-[11px] font-bold text-danger"
            >
              {{ t("records_badge_surrendered") }} (0 PTS)
            </span>
          </div>

          <div class="flex items-center justify-between border-t border-border/60 pt-1.5 text-[11px] text-text-secondary">
            <span>
              👥 {{ t("records_social_solved") }}:
              <strong class="text-text-primary">{{ item.solved_count }}</strong>
              <template v-if="item.best_time_ms !== null">
                • {{ t("records_social_best") }}:
                <strong class="font-condensed text-brand">
                  {{ formatBestSeconds(item.best_time_ms) }}s
                </strong>
              </template>
            </span>
            <span class="font-semibold text-text-primary">
              {{ t("records_analyze_cta") }}
            </span>
          </div>
        </button>
      </div>
    </section>
  </div>
</template>
