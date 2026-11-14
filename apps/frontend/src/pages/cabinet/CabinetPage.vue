<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import {
  ALL_CHALLENGE_DISCIPLINES,
  type ChallengeDiscipline,
} from "shared";
import { useCabinetStore } from "@/entities/cabinet/model/cabinet.store";
import { useI18n } from "@/shared/i18n/useI18n";

const router = useRouter();
const cabinetStore = useCabinetStore();
const { t, disciplineTitle } = useI18n();

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
            <button
              v-if="cabinetStore.isSuperadmin"
              type="button"
              class="rounded-md border border-accent/40 bg-accent/15 px-2.5 py-1 text-xs font-bold tracking-wider text-accent uppercase transition hover:border-accent hover:bg-accent hover:text-on-brand"
              @click="router.push('/super-admin')"
            >
              {{ t("nav_superadmin") }}
            </button>
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
    </section>

    <!-- 4 Discipline Stats Cards (last 7 days) -->
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
  </div>
</template>
