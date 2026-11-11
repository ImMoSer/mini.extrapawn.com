<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  getOfficialClubInviteUrl,
  LEGAL_PRIVACY_URL,
  LEGAL_TERMS_URL,
  type ClubsCompetitionResponseDTO,
} from "shared";
import { useCabinetStore } from "@/entities/cabinet/model/cabinet.store";
import { apiRequest } from "@/shared/api/httpClient";
import { useI18n } from "@/shared/i18n/useI18n";
import { openTelegramUrl } from "@/shared/lib/telegram";

const router = useRouter();
const cabinetStore = useCabinetStore();
const { lang, t } = useI18n();

const data = ref<ClubsCompetitionResponseDTO | null>(null);
const isLoading = ref(false);
const termsAccepted = ref(false);

const maxClubTotal = computed(() => {
  if (!data.value?.clubs.length) return 1;
  return Math.max(1, ...data.value.clubs.map((c) => c.total_points));
});

const addBotDeepLink = computed(() => {
  const botUsername = cabinetStore.data?.bot_username || "ExtraPawnTeleBot";
  return `https://t.me/${botUsername}?startgroup=true&admin=manage_topics+post_messages+pin_messages`;
});

const isClubLimitReached = computed(
  () =>
    !cabinetStore.isSuperadmin &&
    cabinetStore.ownedClubsCount >= cabinetStore.maxOwnedClubs
);

function formatScore(val: number): string {
  if (Number.isInteger(val)) return String(val);
  return val.toFixed(2).replace(/\.?0+$/, "");
}

function handleAddBotToGroup() {
  if (!termsAccepted.value || isClubLimitReached.value) return;
  openTelegramUrl(addBotDeepLink.value);
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
  if (!cabinetStore.data) {
    void cabinetStore.fetchCabinet();
  }
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
        v-for="club in data?.clubs ?? []"
        :key="club.chat_id"
        role="button"
        tabindex="0"
        class="flex cursor-pointer flex-col gap-2 py-3.5 text-left transition hover:bg-elevated/50"
        @click="
          router.push(
            `/challenge/records/${encodeURIComponent(club.chat_id)}`
          )
        "
        @keydown.enter="
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
                <button
                  v-if="club.is_default"
                  type="button"
                  class="inline-flex min-h-6 items-center gap-1 rounded border border-brand/50 bg-brand/15 px-2 py-0.5 text-[10px] font-bold text-brand transition hover:bg-brand hover:text-on-brand"
                  @click.stop="openTelegramUrl(getOfficialClubInviteUrl(lang))"
                >
                  {{ t("clubs_join_official_btn") }}
                </button>
                <button
                  v-if="club.is_admin"
                  type="button"
                  class="inline-flex min-h-6 items-center gap-1.5 rounded border border-accent/40 bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent uppercase transition hover:border-accent hover:bg-accent/25"
                  :title="t('cabinet_open_settings')"
                  @click.stop="
                    router.push(
                      `/club-settings/${encodeURIComponent(club.chat_id)}`
                    )
                  "
                >
                  <span>OWNER / ADMIN</span>
                  <span class="text-xs leading-none">⚙️</span>
                </button>
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

          <!-- Discipline Split (T / E / P / F) + Total Club Points Box -->
          <div class="flex items-center gap-3 font-condensed">
            <div class="text-right text-xs font-bold tracking-wide">
              <span class="text-success">{{ formatScore(club.tactics_points) }}</span>
              <span class="mx-1 text-text-secondary">/</span>
              <span class="text-accent">{{ formatScore(club.theoretical_points) }}</span>
              <span class="mx-1 text-text-secondary">/</span>
              <span class="text-info">{{ formatScore(club.practical_points) }}</span>
              <span class="mx-1 text-text-secondary">/</span>
              <span class="text-warning">{{ formatScore(club.finishhim_points) }}</span>
            </div>

            <div class="flex min-w-11 items-center justify-center rounded-lg border border-brand/40 bg-elevated px-2.5 py-1.5 text-center">
              <span class="text-sm font-bold text-brand">
                {{ formatScore(club.total_points) }}
              </span>
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
      </div>
    </section>

    <!-- 1-Click Add Bot to Supergroup Onboarding (Placed below the last club) -->
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
        <!-- 3 Concise Onboarding Rules -->
        <ul
          class="flex flex-col gap-1.5 rounded-lg border border-border bg-elevated/60 p-3 text-xs leading-relaxed text-text-secondary"
        >
          <li class="flex items-start gap-2">
            <span class="font-bold text-brand">•</span>
            <span>{{ t("clubs_rule_1") }}</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="font-bold text-brand">•</span>
            <span>{{ t("clubs_rule_2") }}</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="font-bold text-brand">•</span>
            <span>{{ t("clubs_rule_3") }}</span>
          </li>
        </ul>

        <label
          class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-elevated p-3 text-xs leading-relaxed text-text-secondary"
        >
          <input
            v-model="termsAccepted"
            type="checkbox"
            class="mt-0.5 h-4 w-4 shrink-0 accent-brand"
          />
          <span>
            {{ t("clubs_terms_prefix") }}
            <button
              type="button"
              class="font-semibold text-brand underline hover:opacity-80"
              @click.stop="openTelegramUrl(LEGAL_TERMS_URL)"
            >
              {{ t("clubs_terms_link") }}
            </button>
            {{ t("clubs_terms_mid") }}
            <button
              type="button"
              class="font-semibold text-brand underline hover:opacity-80"
              @click.stop="openTelegramUrl(LEGAL_PRIVACY_URL)"
            >
              {{ t("clubs_privacy_link") }}
            </button>
            {{ t("clubs_terms_suffix") }}
          </span>
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
  </div>
</template>
