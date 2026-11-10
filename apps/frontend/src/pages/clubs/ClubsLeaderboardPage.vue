<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { ClubsCompetitionResponseDTO } from "shared";
import { apiRequest } from "@/shared/api/httpClient";
import { useI18n } from "@/shared/i18n/useI18n";

const router = useRouter();
const { t } = useI18n();

const data = ref<ClubsCompetitionResponseDTO | null>(null);
const isLoading = ref(false);

const maxClubTotal = computed(() => {
  if (!data.value?.clubs.length) return 1;
  return Math.max(1, ...data.value.clubs.map((c) => c.total_points));
});

function formatScore(val: number): string {
  if (Number.isInteger(val)) return String(val);
  return val.toFixed(2).replace(/\.?0+$/, "");
}

async function fetchClubsLeaderboard() {
  isLoading.value = true;
  try {
    data.value = await apiRequest<ClubsCompetitionResponseDTO>(
      "/clubs/leaderboard"
    );
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => {
  void fetchClubsLeaderboard();
});
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4 px-3 py-4">
    <!-- Header -->
    <section class="glass flex flex-col gap-1.5 p-4">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-bold tracking-wider text-brand uppercase">
          🏆 {{ t("clubs_title") }}
        </span>
        <span class="rounded bg-elevated px-2 py-0.5 text-[11px] font-semibold text-text-secondary">
          30d Rolling
        </span>
      </div>
      <p class="text-xs text-text-secondary">
        {{ t("clubs_subtitle") }}
      </p>
      <div class="mt-1 rounded-lg border border-border bg-elevated px-3 py-2 text-[11px] text-text-secondary">
        💡 {{ t("clubs_scoring_hint") }}
      </div>
    </section>

    <!-- 4-Discipline Legend (Tactics / Theoretical / Practical / Finish Him) -->
    <section class="glass flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs">
      <div class="flex items-center gap-1.5">
        <span class="h-2.5 w-2.5 rounded-xs bg-success"></span>
        <span class="text-text-secondary">Tactics</span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="h-2.5 w-2.5 rounded-xs bg-accent"></span>
        <span class="text-text-secondary">Theoretical</span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="h-2.5 w-2.5 rounded-xs bg-info"></span>
        <span class="text-text-secondary">Practical</span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="h-2.5 w-2.5 rounded-xs bg-warning"></span>
        <span class="text-text-secondary">Finish Him</span>
      </div>
    </section>

    <!-- Clubs Ranking List -->
    <section class="glass flex flex-col divide-y divide-border p-3.5">
      <div
        v-if="isLoading && !data"
        class="py-8 text-center text-xs text-text-secondary"
      >
        Загрузка рейтинга клубов...
      </div>

      <div
        v-else-if="data && !data.clubs.length"
        class="py-8 text-center text-xs text-text-secondary"
      >
        Пока нет зарегистрированных клубов.
      </div>

      <button
        v-for="club in data?.clubs ?? []"
        :key="club.chat_id"
        type="button"
        class="flex flex-col gap-2 py-3.5 text-left transition hover:bg-elevated/50"
        @click="
          router.push(
            `/challenge/records/${encodeURIComponent(club.chat_id)}`
          )
        "
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2.5">
            <span
              class="flex h-6 w-6 items-center justify-center rounded font-condensed text-xs font-bold"
              :class="
                club.rank === 1
                  ? 'bg-brand text-on-brand'
                  : 'bg-elevated text-text-secondary'
              "
            >
              #{{ club.rank }}
            </span>
            <div>
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="text-sm font-bold text-text-primary">
                  {{ club.title }}
                </span>
                <span
                  v-if="club.is_default"
                  class="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-bold text-brand uppercase"
                >
                  OFFICIAL
                </span>
                <span
                  v-if="club.is_admin && !club.is_default"
                  class="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent uppercase"
                >
                  OWNER
                </span>
                <span
                  v-else-if="club.is_member && !club.is_default"
                  class="rounded bg-info/15 px-1.5 py-0.5 text-[10px] font-bold text-info uppercase"
                >
                  MEMBER
                </span>
                <span
                  v-if="!club.is_active"
                  class="rounded bg-elevated px-1.5 py-0.5 text-[10px] font-semibold text-text-disabled uppercase"
                >
                  PAUSED
                </span>
              </div>
              <div class="text-[11px] text-text-secondary">
                <span v-if="club.username">@{{ club.username }} • </span>
                <span>{{ club.active_players_30d }} игроков • {{ club.solved_count_30d }} побед</span>
              </div>
            </div>
          </div>

          <!-- Discipline Split (T / E / P / F) + Arithmetic Mean -->
          <div class="flex items-center gap-3 font-condensed">
            <div class="text-right">
              <div class="text-xs font-bold tracking-wide">
                <span class="text-success">{{ formatScore(club.tactics_points) }}</span>
                <span class="mx-1 text-text-secondary">/</span>
                <span class="text-accent">{{ formatScore(club.theoretical_points) }}</span>
                <span class="mx-1 text-text-secondary">/</span>
                <span class="text-info">{{ formatScore(club.practical_points) }}</span>
                <span class="mx-1 text-text-secondary">/</span>
                <span class="text-warning">{{ formatScore(club.finishhim_points) }}</span>
              </div>
              <div class="text-[10px] text-text-secondary">
                Σ {{ formatScore(club.total_points) }} PTS
              </div>
            </div>

            <div class="rounded-lg border border-brand/40 bg-elevated px-2.5 py-1 text-center">
              <div class="text-[9px] font-bold tracking-wider text-text-secondary uppercase">
                {{ t("clubs_avg_label") }}
              </div>
              <div class="text-sm font-bold text-brand">
                {{ formatScore(club.average_points) }}
              </div>
            </div>
          </div>
        </div>

        <!-- Stacked 4-Discipline Progress Bar -->
        <div class="flex h-2 w-full overflow-hidden rounded-full bg-elevated">
          <div
            v-if="club.tactics_points > 0"
            class="h-full bg-success"
            :style="{
              width: `${(club.tactics_points / maxClubTotal) * 100}%`,
            }"
          ></div>
          <div
            v-if="club.theoretical_points > 0"
            class="h-full bg-accent"
            :style="{
              width: `${(club.theoretical_points / maxClubTotal) * 100}%`,
            }"
          ></div>
          <div
            v-if="club.practical_points > 0"
            class="h-full bg-info"
            :style="{
              width: `${(club.practical_points / maxClubTotal) * 100}%`,
            }"
          ></div>
          <div
            v-if="club.finishhim_points > 0"
            class="h-full bg-warning"
            :style="{
              width: `${(club.finishhim_points / maxClubTotal) * 100}%`,
            }"
          ></div>
        </div>
      </button>
    </section>
  </div>
</template>

