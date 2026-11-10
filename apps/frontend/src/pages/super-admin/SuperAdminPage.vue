<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type {
  ClubStatus,
  ClubSummaryDTO,
  SuperAdminOverviewDTO,
} from "shared";
import { apiRequest } from "@/shared/api/httpClient";

const router = useRouter();
const overview = ref<SuperAdminOverviewDTO | null>(null);
const isLoading = ref(false);
const actionMessage = ref<string | null>(null);

// Promo campaign form
const promoTitle = ref("ExtraPawn Main App Promo");
const promoTextRu = ref(
  "♟ <b>Тренируйся как Профи на ExtraPawn.com!</b>\nГлубокий анализ партий, персональные курсы и спарринг с человекоподобными ботами Maia и MOZERO."
);
const promoTextEn = ref(
  "♟ <b>Train like a Pro on ExtraPawn.com!</b>\nDeep game analysis, personal courses, and sparring against human-like Maia & MOZERO bots."
);
const promoBtnRu = ref("🚀 Открыть ExtraPawn.com");
const promoBtnEn = ref("🚀 Open ExtraPawn.com");
const promoTargetUrl = ref("https://extrapawn.com");

async function fetchOverview() {
  isLoading.value = true;
  try {
    overview.value = await apiRequest<SuperAdminOverviewDTO>(
      "/superadmin/overview"
    );
  } finally {
    isLoading.value = false;
  }
}

async function updateClubStatus(
  club: ClubSummaryDTO,
  status: ClubStatus,
  leaveChat: boolean = false
) {
  actionMessage.value = null;
  const updated = await apiRequest<ClubSummaryDTO>(
    `/superadmin/clubs/${encodeURIComponent(club.chat_id)}/status`,
    {
      method: "POST",
      body: JSON.stringify({
        status,
        blocked_reason:
          status === "blocked" ? "Blocked by SuperAdmin 5106981885" : null,
        leave_chat: leaveChat,
      }),
    }
  );

  if (overview.value) {
    const idx = overview.value.clubs.findIndex(
      (c) => c.chat_id === updated.chat_id
    );
    if (idx >= 0) {
      overview.value.clubs[idx] = updated;
    }
  }
  actionMessage.value = `Статус клуба «${club.title}» изменен на ${status.toUpperCase()}`;
}

async function triggerClubChallenge(club: ClubSummaryDTO) {
  actionMessage.value = null;
  await apiRequest(`/clubs/${encodeURIComponent(club.chat_id)}/publish-now`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  actionMessage.value = `Челлендж отправлен в клуб «${club.title}»!`;
  await fetchOverview();
}

async function sendPromoBroadcast() {
  actionMessage.value = null;
  const res = await apiRequest<{ ok: boolean; sent_to_clubs: number }>(
    "/superadmin/promos",
    {
      method: "POST",
      body: JSON.stringify({
        title: promoTitle.value,
        text_ru: promoTextRu.value,
        text_en: promoTextEn.value,
        button_ru: promoBtnRu.value,
        button_en: promoBtnEn.value,
        target_url: promoTargetUrl.value,
        broadcast_now: true,
      }),
    }
  );
  actionMessage.value = `Промо-кампания отправлена в ${res.sent_to_clubs} активных клубов!`;
  await fetchOverview();
}

onMounted(() => {
  void fetchOverview();
});
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4 px-3 py-4">
    <!-- SuperAdmin Header -->
    <section class="glass flex items-center justify-between p-4">
      <div>
        <div class="text-xs font-bold tracking-wider text-accent uppercase">
          SUPERADMIN CONTROL PANEL
        </div>
        <h1 class="mt-0.5 text-base font-bold text-text-primary">
          Управление мини-приложением (ID: 5106981885)
        </h1>
      </div>
      <button
        type="button"
        class="rounded-md border border-border bg-elevated px-3 py-1.5 text-xs font-bold text-text-primary hover:border-brand"
        @click="fetchOverview"
      >
        ↻ Обновить
      </button>
    </section>

    <div
      v-if="actionMessage"
      class="rounded-lg border border-brand/40 bg-brand/15 px-3 py-2 text-xs font-bold text-brand"
    >
      {{ actionMessage }}
    </div>

    <!-- Global KPIs -->
    <section v-if="overview" class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      <div class="glass p-3">
        <div class="text-[11px] text-text-secondary uppercase">Игроков</div>
        <div class="font-condensed text-xl font-bold text-text-primary">
          {{ overview.total_users }}
        </div>
      </div>
      <div class="glass p-3">
        <div class="text-[11px] text-text-secondary uppercase">Клубов</div>
        <div class="font-condensed text-xl font-bold text-brand">
          {{ overview.total_clubs }}
        </div>
      </div>
      <div class="glass p-3">
        <div class="text-[11px] text-text-secondary uppercase">Попыток</div>
        <div class="font-condensed text-xl font-bold text-info">
          {{ overview.total_attempts }}
        </div>
      </div>
      <div class="glass p-3">
        <div class="text-[11px] text-text-secondary uppercase">Успехов</div>
        <div class="font-condensed text-xl font-bold text-success">
          {{ overview.total_solved }}
        </div>
      </div>
    </section>

    <!-- All Connected Clubs Management -->
    <section v-if="overview" class="glass flex flex-col gap-3 p-4">
      <h2 class="text-xs font-bold tracking-wider text-text-secondary uppercase">
        УПРАВЛЕНИЕ КЛУБАМИ (РАЗРЕШЕНИЕ / БЛОКИРОВКА)
      </h2>

      <div class="flex flex-col divide-y divide-border">
        <div
          v-for="club in overview.clubs"
          :key="club.chat_id"
          class="flex flex-col gap-2 py-3"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div class="flex items-center gap-2">
                <span class="text-sm font-bold text-text-primary">
                  {{ club.title }}
                </span>
                <span
                  class="rounded px-2 py-0.5 text-[10px] font-bold uppercase"
                  :class="
                    club.status === 'active'
                      ? 'bg-success/15 text-success'
                      : club.status === 'blocked'
                        ? 'bg-danger/15 text-danger'
                        : 'bg-warning/15 text-warning'
                  "
                >
                  {{ club.status }}
                </span>
              </div>
              <div class="font-condensed text-xs text-text-secondary">
                chat_id: {{ club.chat_id }} • thread: #{{
                  club.topic_thread_id
                }}
                • members: {{ club.member_count }} • challenges:
                {{ club.published_challenges_count }}
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                class="rounded border border-border bg-elevated px-2.5 py-1 text-xs font-bold text-brand hover:border-brand"
                @click="triggerClubChallenge(club)"
              >
                🚀 Пост
              </button>

              <button
                type="button"
                class="rounded border border-border bg-elevated px-2.5 py-1 text-xs font-bold text-text-primary hover:border-brand"
                @click="
                  router.push(
                    `/club-settings/${encodeURIComponent(club.chat_id)}`
                  )
                "
              >
                ⚙️ Настройки
              </button>

              <button
                v-if="club.status !== 'active'"
                type="button"
                class="rounded bg-success px-2.5 py-1 text-xs font-bold text-on-brand"
                @click="updateClubStatus(club, 'active', false)"
              >
                ✓ Разрешить
              </button>

              <button
                v-if="club.status !== 'blocked' && !club.is_default"
                type="button"
                class="rounded bg-danger px-2.5 py-1 text-xs font-bold text-on-brand"
                @click="updateClubStatus(club, 'blocked', true)"
              >
                ⛔ Блок + Выйти
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Promo Campaign Broadcaster -->
    <section class="glass flex flex-col gap-3 p-4">
      <h2 class="text-xs font-bold tracking-wider text-accent uppercase">
        ПРОМО-РАССЫЛКА ПО АКТИВНЫМ КЛУБАМ
      </h2>

      <input
        v-model="promoTitle"
        type="text"
        placeholder="Название кампании"
        class="rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-text-primary"
      />

      <textarea
        v-model="promoTextRu"
        rows="3"
        placeholder="Текст поста (RU, HTML)"
        class="rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-text-primary"
      ></textarea>

      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          v-model="promoBtnRu"
          type="text"
          placeholder="Текст кнопки (RU)"
          class="rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-text-primary"
        />
        <input
          v-model="promoTargetUrl"
          type="text"
          placeholder="URL кнопки"
          class="rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-text-primary"
        />
      </div>

      <button
        type="button"
        class="rounded-lg bg-accent py-2.5 text-xs font-bold text-on-brand transition hover:bg-accent-deep"
        @click="sendPromoBroadcast"
      >
        📢 Отправить промо во все активные клубы
      </button>
    </section>
  </div>
</template>

