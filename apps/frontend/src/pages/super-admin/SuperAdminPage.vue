<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type {
  ClubSummaryDTO,
  PostgresDoctorReportDTO,
  PromoCampaignDTO,
  PromoTranslationsPayload,
  SuperAdminOverviewDTO,
} from "shared";
import SuperAdminClubsSection from "@/pages/super-admin/ui/SuperAdminClubsSection.vue";
import SuperAdminPostgresDoctorCard from "@/pages/super-admin/ui/SuperAdminPostgresDoctorCard.vue";
import SuperAdminPromoSection from "@/pages/super-admin/ui/SuperAdminPromoSection.vue";
import { apiRequest } from "@/shared/api/httpClient";

const router = useRouter();
const overview = ref<SuperAdminOverviewDTO | null>(null);
const isLoading = ref(false);
const isVacuuming = ref(false);
const busyClubId = ref<string | null>(null);
const isSendingPromo = ref(false);
const isSavingPromo = ref(false);
const actionMessage = ref<string | null>(null);

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

async function runPostgresVacuum() {
  isVacuuming.value = true;
  actionMessage.value = null;
  try {
    const freshReport = await apiRequest<PostgresDoctorReportDTO>(
      "/superadmin/postgres-doctor/vacuum",
      { method: "POST" }
    );
    if (overview.value) {
      overview.value.postgres_health = freshReport;
    }
    actionMessage.value =
      "🧹 Онлайн-профилактика VACUUM (ANALYZE) в базе chess_db успешно выполнена!";
  } finally {
    isVacuuming.value = false;
  }
}

async function approveClub(club: ClubSummaryDTO) {
  actionMessage.value = null;
  busyClubId.value = club.chat_id;
  try {
    await apiRequest<ClubSummaryDTO>(
      `/superadmin/clubs/${encodeURIComponent(club.chat_id)}/approve`,
      { method: "POST" }
    );
    actionMessage.value = `✅ Заявка клуба «${club.title}» одобрена! Приветствие и первый челлендж отправлены.`;
    await fetchOverview();
  } finally {
    busyClubId.value = null;
  }
}

async function rejectClub(club: ClubSummaryDTO) {
  if (
    !window.confirm(
      `Отклонить заявку клуба «${club.title}»? Бот вежливо выйдет из группы, заявка будет удалена.`
    )
  ) {
    return;
  }
  actionMessage.value = null;
  busyClubId.value = club.chat_id;
  try {
    await apiRequest<{ ok: boolean }>(
      `/superadmin/clubs/${encodeURIComponent(club.chat_id)}/reject`,
      { method: "POST" }
    );
    actionMessage.value = `🚫 Заявка клуба «${club.title}» отклонена, бот покинул супергруппу.`;
    await fetchOverview();
  } finally {
    busyClubId.value = null;
  }
}

async function toggleClubBlacklist(club: ClubSummaryDTO, blocked: boolean) {
  actionMessage.value = null;
  busyClubId.value = club.chat_id;
  try {
    const updated = await apiRequest<ClubSummaryDTO>(
      `/superadmin/clubs/${encodeURIComponent(club.chat_id)}/block`,
      {
        method: "POST",
        body: JSON.stringify({
          blocked,
          blocked_reason: blocked ? "Blocked by SuperAdmin 5106981885" : null,
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
    actionMessage.value = blocked
      ? `Клуб «${club.title}» заблокирован (внесен в черный список, отправлено уведомление с QR @ProfessorMozer, бот вышел из чата).`
      : `С клуба «${club.title}» снята блокировка.`;
  } finally {
    busyClubId.value = null;
  }
}

async function purgeClubData(club: ClubSummaryDTO) {
  const confirmMsg =
    club.status === "blocked"
      ? `Удалить всю историю активности клуба «${club.title}» из PostgreSQL? (Запись о блокировке в черном списке сохранится)`
      : `Удалить все данные клуба «${club.title}» из PostgreSQL и отключить бота?`;

  if (!window.confirm(confirmMsg)) {
    return;
  }

  actionMessage.value = null;
  busyClubId.value = club.chat_id;
  try {
    const res = await apiRequest<{
      ok: boolean;
      deleted_club_row: boolean;
      club: ClubSummaryDTO | null;
    }>(`/superadmin/clubs/${encodeURIComponent(club.chat_id)}/data`, {
      method: "DELETE",
    });

    if (res.deleted_club_row) {
      actionMessage.value = `Все данные клуба «${club.title}» полностью удалены из PostgreSQL, бот покинул чат.`;
    } else {
      actionMessage.value = `История активности клуба «${club.title}» очищена в PostgreSQL (черный список сохранен).`;
    }
    await fetchOverview();
  } finally {
    busyClubId.value = null;
  }
}

async function triggerClubChallenge(club: ClubSummaryDTO) {
  actionMessage.value = null;
  busyClubId.value = club.chat_id;
  try {
    await apiRequest(`/clubs/${encodeURIComponent(club.chat_id)}/publish-now`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    actionMessage.value = `Челлендж отправлен в клуб «${club.title}»!`;
    await fetchOverview();
  } finally {
    busyClubId.value = null;
  }
}

async function submitPromoCampaign(payload: {
  title: string;
  fileId: string;
  targetUrl: string;
  translations: PromoTranslationsPayload;
  broadcastNow: boolean;
}) {
  actionMessage.value = null;
  if (payload.broadcastNow) {
    isSendingPromo.value = true;
  } else {
    isSavingPromo.value = true;
  }

  try {
    const { ru, en, de } = payload.translations;
    const res = await apiRequest<{
      ok: boolean;
      sent_to_clubs: number;
      promo: PromoCampaignDTO | null;
    }>("/superadmin/promos", {
      method: "POST",
      body: JSON.stringify({
        title: payload.title,
        file_id: payload.fileId,
        target_url: payload.targetUrl,
        text_ru: ru.text,
        text_en: en.text,
        text_de: de.text,
        button_ru: ru.button,
        button_en: en.button,
        button_de: de.button,
        broadcast_now: payload.broadcastNow,
      }),
    });

    actionMessage.value = payload.broadcastNow
      ? `Промо-кампания (фото + текст с кнопкой) сохранена и отправлена в ${res.sent_to_clubs} активных клубов!`
      : "Последний промо-пост сохранен как шаблон!";
    await fetchOverview();
  } finally {
    isSendingPromo.value = false;
    isSavingPromo.value = false;
  }
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
        :disabled="isLoading"
        class="min-w-0 truncate rounded-md border border-border bg-elevated px-3 py-1.5 text-xs font-bold text-text-primary hover:border-brand disabled:opacity-50"
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

    <!-- PostgreSQL Doctor Card -->
    <SuperAdminPostgresDoctorCard
      v-if="overview?.postgres_health"
      :report="overview.postgres_health"
      :is-vacuuming="isVacuuming"
      @vacuum="runPostgresVacuum"
    />

    <!-- Club Applications & Connected Clubs Management -->
    <SuperAdminClubsSection
      v-if="overview"
      :clubs="overview.clubs"
      :busy-club-id="busyClubId"
      @approve="approveClub"
      @reject="rejectClub"
      @trigger-challenge="triggerClubChallenge"
      @open-settings="
        (club) =>
          router.push(`/club-settings/${encodeURIComponent(club.chat_id)}`)
      "
      @toggle-blacklist="toggleClubBlacklist"
      @purge-data="purgeClubData"
    />

    <!-- Promo Campaign Broadcaster -->
    <SuperAdminPromoSection
      :latest-promo="overview?.promos[0] ?? null"
      :is-saving-promo="isSavingPromo"
      :is-sending-promo="isSendingPromo"
      @submit-promo="submitPromoCampaign"
    />
  </div>
</template>
