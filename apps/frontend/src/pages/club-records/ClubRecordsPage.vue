<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  DEFAULT_CLUB_CHAT_ID,
  type ClubChallengeItemDTO,
  type ClubRecordsResponseDTO,
} from "shared";
import { apiRequest } from "@/shared/api/httpClient";
import { useI18n } from "@/shared/i18n/useI18n";

const route = useRoute();
const router = useRouter();
const { t, disciplineTitle, difficultyTitle, focusTitle } = useI18n();

const data = ref<ClubRecordsResponseDTO | null>(null);
const isLoading = ref(false);
const challengesTab = ref<"active" | "completed">("active");

const chatId = computed(() =>
  route.params.chatId ? String(route.params.chatId) : DEFAULT_CLUB_CHAT_ID
);

const activeChallenges = computed<ClubChallengeItemDTO[]>(() =>
  (data.value?.recent_challenges ?? []).filter(
    (item) => item.my_status !== "solved" && item.my_status !== "surrendered"
  )
);

const completedChallenges = computed<ClubChallengeItemDTO[]>(() =>
  (data.value?.recent_challenges ?? []).filter(
    (item) => item.my_status === "solved" || item.my_status === "surrendered"
  )
);

const maxTotalPoints = computed(() => {
  if (!data.value?.records.length) return 1;
  return Math.max(1, ...data.value.records.map((r) => r.total_points));
});

const maxTotalSeconds = computed(() => {
  if (!data.value?.records.length) return 1;
  return Math.max(1, ...data.value.records.map((r) => r.total_seconds));
});

function formatBestSeconds(ms: number | null): string {
  if (ms === null || ms === undefined) return "";
  return (Math.round((ms / 1000) * 10) / 10).toFixed(1);
}

function formatPoints(pts: number): string {
  if (Number.isInteger(pts)) return String(pts);
  return pts.toFixed(2).replace(/\.?0+$/, "");
}

function openChallenge(item: ClubChallengeItemDTO) {
  if (!data.value) return;
  void router.push(
    `/challenge/${item.discipline}/${encodeURIComponent(
      item.puzzle_id
    )}/${encodeURIComponent(item.edition)}/${encodeURIComponent(
      data.value.club.chat_id
    )}`
  );
}

async function fetchClubRecords() {
  isLoading.value = true;
  try {
    const res = await apiRequest<ClubRecordsResponseDTO>(
      `/challenges/records/${encodeURIComponent(chatId.value)}`
    );
    data.value = res;
    challengesTab.value = "active";
  } finally {
    isLoading.value = false;
  }
}

watch(chatId, () => {
  void fetchClubRecords();
});

onMounted(() => {
  void fetchClubRecords();
});
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4 px-3 py-4">
    <!-- Club Header -->
    <section
      v-if="data"
      class="glass flex flex-wrap items-center justify-between gap-3 p-4"
    >
      <div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs font-bold tracking-wider text-brand uppercase">
            {{ t("records_club_title") }}
          </span>
          <span class="rounded bg-elevated px-2 py-0.5 text-[11px] text-text-secondary">
            Topic #{{ data.club.topic_thread_id }}
          </span>
          <span
            v-if="data.club.auto_paused && data.club.is_active"
            class="rounded bg-warning/20 px-2 py-0.5 text-[10px] font-bold text-warning uppercase"
          >
            ⏸ AUTO-PAUSE
          </span>
          <span
            v-else-if="!data.club.is_active"
            class="rounded bg-elevated px-2 py-0.5 text-[10px] font-bold text-text-disabled uppercase"
          >
            PAUSED
          </span>
        </div>
        <h1 class="mt-0.5 text-lg font-bold text-text-primary">
          {{ data.club.title }}
        </h1>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-semibold text-text-secondary hover:border-brand hover:text-text-primary"
          @click="router.push('/clubs')"
        >
          🏆 {{ t("nav_clubs") }}
        </button>

        <button
          v-if="data.club.is_admin"
          type="button"
          class="rounded-lg border border-brand/40 bg-elevated px-3 py-1.5 text-xs font-bold text-brand hover:border-brand"
          @click="
            router.push(`/club-settings/${encodeURIComponent(data.club.chat_id)}`)
          "
        >
          ⚙️ {{ t("cabinet_open_settings") }}
        </button>
      </div>
    </section>

    <!-- Club Challenges Section (2 Tabs: 🔥 Активные / ✅ Пройденные) -->
    <section
      v-if="data && data.recent_challenges.length > 0"
      class="glass flex flex-col gap-3 p-3.5"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-xs font-bold tracking-wider text-text-secondary uppercase">
          {{ t("records_recent_challenges") }}
        </h2>

        <div class="grid grid-cols-2 gap-1 rounded-lg border border-border bg-elevated p-1">
          <button
            type="button"
            class="rounded-md px-3 py-1 text-xs font-bold transition"
            :class="
              challengesTab === 'active'
                ? 'bg-brand text-on-brand'
                : 'text-text-secondary hover:text-text-primary'
            "
            @click="challengesTab = 'active'"
          >
            {{ t("records_tab_active") }} ({{ activeChallenges.length }})
          </button>

          <button
            type="button"
            class="rounded-md px-3 py-1 text-xs font-bold transition"
            :class="
              challengesTab === 'completed'
                ? 'bg-accent text-on-brand'
                : 'text-text-secondary hover:text-text-primary'
            "
            @click="challengesTab = 'completed'"
          >
            {{ t("records_tab_completed") }} ({{ completedChallenges.length }})
          </button>
        </div>
      </div>

      <!-- TAB: Active Challenges -->
      <template v-if="challengesTab === 'active'">
        <div
          v-if="!activeChallenges.length"
          class="rounded-lg border border-border bg-elevated/60 py-5 text-center text-xs text-text-secondary"
        >
          {{ t("records_no_active") }}
        </div>

        <div v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            v-for="item in activeChallenges"
            :key="`${item.discipline}-${item.puzzle_id}-${item.edition}`"
            type="button"
            class="flex flex-col justify-between gap-2 rounded-lg border border-border bg-elevated p-3 text-left text-xs transition hover:border-brand"
            @click="openChallenge(item)"
          >
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="font-bold text-text-primary">
                  {{ disciplineTitle(item.discipline) }}
                </div>
                <div class="mt-0.5 text-[11px] text-text-secondary">
                  <span class="font-semibold text-text-primary/90">
                    {{ focusTitle(item.discipline, item.category) }}
                  </span>
                  <span> • {{ difficultyTitle(item.difficulty) }}</span>
                </div>
              </div>
              <span class="shrink-0 font-bold text-brand">{{ t("go_solve_cta") }}</span>
            </div>

            <div
              v-if="item.solved_count > 0"
              class="flex items-center gap-1.5 border-t border-border/60 pt-1.5 text-[11px] text-text-secondary"
            >
              <span>
                👥 {{ t("records_social_solved") }}:
                <strong class="text-text-primary">{{ item.solved_count }}</strong>
              </span>
              <span v-if="item.best_time_ms !== null">
                • {{ t("records_social_best") }}:
                <strong class="font-condensed text-brand">
                  {{ formatBestSeconds(item.best_time_ms) }}s
                </strong>
              </span>
            </div>
          </button>
        </div>
      </template>

      <!-- TAB: Completed Challenges -->
      <template v-else>
        <div
          v-if="!completedChallenges.length"
          class="rounded-lg border border-border bg-elevated/60 py-5 text-center text-xs text-text-secondary"
        >
          {{ t("records_no_completed") }}
        </div>

        <div v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            v-for="item in completedChallenges"
            :key="`${item.discipline}-${item.puzzle_id}-${item.edition}`"
            type="button"
            class="flex flex-col justify-between gap-2 rounded-lg border bg-elevated p-3 text-left text-xs transition"
            :class="
              item.my_status === 'solved'
                ? 'border-accent/35 hover:border-accent'
                : 'border-danger/35 hover:border-danger'
            "
            @click="openChallenge(item)"
          >
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="font-bold text-text-primary">
                  {{ disciplineTitle(item.discipline) }}
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
              <span class="font-semibold text-text-primary">{{ t("records_analyze_cta") }}</span>
            </div>
          </button>
        </div>
      </template>
    </section>

    <!-- Discipline Legend -->
    <section class="glass flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs">
      <div class="flex items-center gap-1.5">
        <span class="h-2.5 w-2.5 rounded-xs bg-success"></span>
        <span class="text-text-secondary">Tactics</span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="h-2.5 w-2.5 rounded-xs bg-warning"></span>
        <span class="text-text-secondary">Finish Him</span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="h-2.5 w-2.5 rounded-xs bg-info"></span>
        <span class="text-text-secondary">Practical</span>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="h-2.5 w-2.5 rounded-xs bg-accent"></span>
        <span class="text-text-secondary">Theoretical</span>
      </div>
    </section>

    <!-- Club Leaderboard Rows -->
    <section v-if="data" class="glass flex flex-col divide-y divide-border p-3.5">
      <div
        v-if="!data.records.length"
        class="py-6 text-center text-xs text-text-secondary"
      >
        Пока нет решенных челленджей в этом клубе.
      </div>

      <div
        v-for="rec in data.records"
        :key="rec.telegram_id"
        class="flex flex-col gap-1.5 py-3"
      >
        <div class="flex items-center justify-between text-xs">
          <div class="flex items-center gap-2">
            <span class="w-6 font-condensed font-bold text-text-secondary">
              #{{ rec.rank }}
            </span>
            <span class="font-bold text-text-primary">
              {{ rec.display_name }}
            </span>
          </div>

          <div class="flex items-center gap-3 font-condensed">
            <span class="font-bold text-brand">
              {{ rec.total_points }} PTS
            </span>
            <span class="text-text-secondary">
              {{ rec.solved_count }}/{{ rec.attempted_puzzles }} ({{
                rec.total_attempts
              }}
              att)
            </span>
            <span class="w-14 text-right text-text-secondary">
              {{ rec.total_seconds.toFixed(1) }}s
            </span>
          </div>
        </div>

        <!-- Stacked Discipline Bar -->
        <div class="flex h-2 w-full overflow-hidden rounded-full bg-elevated">
          <div
            v-if="rec.tactics_points > 0"
            class="h-full bg-success"
            :style="{
              width: `${(rec.tactics_points / maxTotalPoints) * 100}%`,
            }"
          ></div>
          <div
            v-if="rec.finishhim_points > 0"
            class="h-full bg-warning"
            :style="{
              width: `${(rec.finishhim_points / maxTotalPoints) * 100}%`,
            }"
          ></div>
          <div
            v-if="rec.practical_points > 0"
            class="h-full bg-info"
            :style="{
              width: `${(rec.practical_points / maxTotalPoints) * 100}%`,
            }"
          ></div>
          <div
            v-if="rec.theoretical_points > 0"
            class="h-full bg-accent"
            :style="{
              width: `${(rec.theoretical_points / maxTotalPoints) * 100}%`,
            }"
          ></div>
        </div>

        <!-- Solve Time Bar -->
        <div class="h-1 w-full overflow-hidden rounded-full bg-elevated">
          <div
            class="h-full bg-text-secondary/50"
            :style="{
              width: `${Math.min(
                100,
                (rec.total_seconds / maxTotalSeconds) * 100
              )}%`,
            }"
          ></div>
        </div>
      </div>
    </section>
  </div>
</template>

