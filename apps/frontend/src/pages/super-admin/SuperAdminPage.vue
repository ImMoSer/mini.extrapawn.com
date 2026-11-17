<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  DEFAULT_PROMO_FILE_ID,
  DEFAULT_PROMO_TRANSLATIONS,
  parseAndValidatePromoTranslationsJson,
  type AppLanguage,
  type ClubSummaryDTO,
  type PromoCampaignDTO,
  type PromoTranslationsPayload,
  type SuperAdminOverviewDTO,
} from "shared";
import SuperAdminClubsSection from "@/pages/super-admin/ui/SuperAdminClubsSection.vue";
import { apiRequest } from "@/shared/api/httpClient";

const router = useRouter();
const overview = ref<SuperAdminOverviewDTO | null>(null);
const isLoading = ref(false);
const busyClubId = ref<string | null>(null);
const isSendingPromo = ref(false);
const isSavingPromo = ref(false);
const actionMessage = ref<string | null>(null);
const copyNotice = ref<string | null>(null);

// 3 rarely-changing shared fields
const promoTitle = ref("ExtraPawn Main App Promo");
const promoFileId = ref(DEFAULT_PROMO_FILE_ID);
const promoTargetUrl = ref("https://extrapawn.com");

function formatTranslationsJson(payload: PromoTranslationsPayload): string {
  return JSON.stringify(payload, null, 2);
}

const promoJsonText = ref<string>(
  formatTranslationsJson(DEFAULT_PROMO_TRANSLATIONS)
);
const previewLang = ref<AppLanguage>("ru");
const savedPromoSnapshot = ref<string>("");

function buildCurrentPromoSnapshot(): string {
  return JSON.stringify({
    title: promoTitle.value.trim(),
    file_id: promoFileId.value.trim(),
    target_url: promoTargetUrl.value.trim(),
    json: promoJsonText.value.trim(),
  });
}

const isPromoDirty = computed(
  () =>
    savedPromoSnapshot.value === "" ||
    buildCurrentPromoSnapshot() !== savedPromoSnapshot.value
);

const parsedPromoJson = computed(() =>
  parseAndValidatePromoTranslationsJson(promoJsonText.value)
);

const currentPreviewItem = computed(() => {
  if (!parsedPromoJson.value.ok) return null;
  return parsedPromoJson.value.data[previewLang.value];
});

function hydrateFromLatestPromo(latest: PromoCampaignDTO) {
  promoTitle.value = latest.title || "ExtraPawn Main App Promo";
  promoFileId.value = latest.file_id || latest.image_url || DEFAULT_PROMO_FILE_ID;
  promoTargetUrl.value = latest.target_url || "https://extrapawn.com";

  const payload: PromoTranslationsPayload = {
    ru: {
      text: latest.text_ru || DEFAULT_PROMO_TRANSLATIONS.ru.text,
      button: latest.button_ru || DEFAULT_PROMO_TRANSLATIONS.ru.button,
    },
    en: {
      text: latest.text_en || DEFAULT_PROMO_TRANSLATIONS.en.text,
      button: latest.button_en || DEFAULT_PROMO_TRANSLATIONS.en.button,
    },
    de: {
      text:
        latest.text_de ||
        latest.text_en ||
        DEFAULT_PROMO_TRANSLATIONS.de.text,
      button:
        latest.button_de ||
        latest.button_en ||
        DEFAULT_PROMO_TRANSLATIONS.de.button,
    },
  };

  promoJsonText.value = formatTranslationsJson(payload);
  savedPromoSnapshot.value = buildCurrentPromoSnapshot();
}

async function fetchOverview() {
  isLoading.value = true;
  try {
    const res = await apiRequest<SuperAdminOverviewDTO>("/superadmin/overview");
    overview.value = res;
    const latestPromo = res.promos[0];
    if (latestPromo) {
      hydrateFromLatestPromo(latestPromo);
    } else if (!savedPromoSnapshot.value) {
      savedPromoSnapshot.value = buildCurrentPromoSnapshot();
    }
  } finally {
    isLoading.value = false;
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

async function copyJsonOnly() {
  await navigator.clipboard.writeText(promoJsonText.value);
  copyNotice.value = "JSON скопирован в буфер обмена!";
  setTimeout(() => {
    copyNotice.value = null;
  }, 2500);
}

async function copyAgentPromptWithExample() {
  const promptLines = [
    "Сгенерируй промо-пост на трех языках (ru, en, de) строго в формате JSON по примеру ниже.",
    "",
    "Правила верстки Telegram HTML:",
    '- Используй ТОЛЬКО разрешенные HTML-теги Telegram: <b>жирный</b>, <i>курсив</i>, <blockquote>цитата</blockquote>, ссылки строго <a href="URL">Текст</a>.',
    "- ЗАПРЕЩЕНО: любые другие теги (<br>, <p>), Markdown-разметка (**bold**, #, `code`), блоки кода (```). Переносы строк делай обычным переводом строки (\\n в JSON).",
    "",
    "Пример содержания и точного формата JSON для ответа:",
    promoJsonText.value,
  ].join("\n");

  await navigator.clipboard.writeText(promptLines);
  copyNotice.value = "ТЗ + пример JSON для ИИ-агента скопированы!";
  setTimeout(() => {
    copyNotice.value = null;
  }, 2500);
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

async function submitPromoCampaign(broadcastNow: boolean) {
  if (!parsedPromoJson.value.ok) return;

  actionMessage.value = null;
  if (broadcastNow) {
    isSendingPromo.value = true;
  } else {
    isSavingPromo.value = true;
  }

  try {
    const { ru, en, de } = parsedPromoJson.value.data;
    const res = await apiRequest<{
      ok: boolean;
      sent_to_clubs: number;
      promo: PromoCampaignDTO | null;
    }>("/superadmin/promos", {
      method: "POST",
      body: JSON.stringify({
        title: promoTitle.value.trim() || "ExtraPawn Main App Promo",
        file_id: promoFileId.value.trim() || DEFAULT_PROMO_FILE_ID,
        target_url: promoTargetUrl.value.trim() || "https://extrapawn.com",
        text_ru: ru.text,
        text_en: en.text,
        text_de: de.text,
        button_ru: ru.button,
        button_en: en.button,
        button_de: de.button,
        broadcast_now: broadcastNow,
      }),
    });

    if (res.promo) {
      hydrateFromLatestPromo(res.promo);
    } else {
      savedPromoSnapshot.value = buildCurrentPromoSnapshot();
    }

    actionMessage.value = broadcastNow
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
        class="min-w-0 truncate rounded-md border border-border bg-elevated px-3 py-1.5 text-xs font-bold text-text-primary hover:border-brand"
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
    <section class="glass flex flex-col gap-3 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 class="text-xs font-bold tracking-wider text-accent uppercase">
            ПРОМО-РАССЫЛКА ПО АКТИВНЫМ КЛУБАМ
          </h2>
          <p class="mt-0.5 text-[11px] text-text-secondary">
            Сначала отправляется фото (<code>file_id</code>), затем сразу текст с кнопкой на языке клуба (RU / EN / DE).
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            class="min-w-0 truncate rounded-md border border-border bg-elevated px-2.5 py-1 text-[11px] font-bold text-text-primary transition hover:border-brand hover:text-brand"
            @click="copyJsonOnly"
          >
            📋 JSON
          </button>
          <button
            type="button"
            class="min-w-0 truncate rounded-md border border-accent/40 bg-accent/15 px-2.5 py-1 text-[11px] font-bold text-accent transition hover:border-accent"
            @click="copyAgentPromptWithExample"
          >
            🤖 ТЗ агенту
          </button>
        </div>
      </div>

      <div
        v-if="copyNotice"
        class="rounded-md border border-brand/40 bg-brand/15 px-3 py-1.5 text-xs font-semibold text-brand"
      >
        ✓ {{ copyNotice }}
      </div>

      <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="text-[10px] font-bold tracking-wider text-text-secondary uppercase">
            Название кампании (title)
          </span>
          <input
            v-model="promoTitle"
            type="text"
            placeholder="ExtraPawn Main App Promo"
            class="rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-text-primary focus:border-brand focus:outline-none"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-[10px] font-bold tracking-wider text-text-secondary uppercase">
            Ссылка кнопки (target_url)
          </span>
          <input
            v-model="promoTargetUrl"
            type="text"
            placeholder="https://extrapawn.com"
            class="rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-text-primary focus:border-brand focus:outline-none"
          />
        </label>
      </div>

      <label class="flex flex-col gap-1">
        <span class="text-[10px] font-bold tracking-wider text-text-secondary uppercase">
          Telegram Photo file_id (одна фотография для всех языков, отправляется первой)
        </span>
        <input
          v-model="promoFileId"
          type="text"
          placeholder="AgACAgIAAxkBAAMLavQp75AR4Z4d1VjxaSOIjabIpRMAAm8baxvxDaBLmU2Ch__KXhQBAAMCAAN5AAM9BA"
          class="rounded-lg border border-border bg-elevated px-3 py-2 font-mono text-xs text-text-primary focus:border-brand focus:outline-none"
        />
      </label>

      <div class="flex flex-col gap-1.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-[10px] font-bold tracking-wider text-text-secondary uppercase">
            JSON текстов и кнопок (ru / en / de)
          </span>
          <span
            v-if="parsedPromoJson.ok"
            class="rounded bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success"
          >
            ✓ JSON и Telegram HTML валидны
          </span>
          <span
            v-else
            class="rounded bg-danger/15 px-2 py-0.5 text-[10px] font-bold text-danger"
          >
            ✕ {{ parsedPromoJson.error }}
          </span>
        </div>

        <textarea
          v-model="promoJsonText"
          rows="14"
          spellcheck="false"
          class="rounded-lg border bg-elevated p-3 font-mono text-xs leading-relaxed text-text-primary focus:outline-none"
          :class="
            parsedPromoJson.ok
              ? 'border-border focus:border-brand'
              : 'border-danger/60 focus:border-danger'
          "
        ></textarea>

        <div class="text-[11px] text-text-secondary">
          Разрешены только теги: <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>,
          <code>&lt;blockquote&gt;</code>, <code>&lt;a href="URL"&gt;</code>.
        </div>
      </div>

      <div
        v-if="parsedPromoJson.ok && currentPreviewItem"
        class="flex flex-col gap-2.5 rounded-xl border border-border bg-elevated p-3.5"
      >
        <div class="flex items-center justify-between gap-2 border-b border-border pb-2">
          <span class="text-[11px] font-bold tracking-wider text-text-secondary uppercase">
            Предпросмотр сообщения в Telegram
          </span>
          <div class="flex items-center gap-1">
            <button
              v-for="l in ['ru', 'en', 'de'] as const"
              :key="l"
              type="button"
              class="rounded px-2.5 py-1 text-[11px] font-bold uppercase transition"
              :class="
                previewLang === l
                  ? 'bg-brand text-on-brand'
                  : 'bg-surface text-text-secondary hover:text-text-primary'
              "
              @click="previewLang = l"
            >
              {{ l }}
            </button>
          </div>
        </div>

        <div class="flex items-center gap-2 rounded-lg border border-border/70 bg-surface px-3 py-2 text-xs text-text-secondary">
          <span>🖼 <strong>Сообщение #1 (Фото):</strong></span>
          <span class="truncate font-mono text-[11px] text-brand">
            {{ promoFileId || "Без фото" }}
          </span>
        </div>

        <div class="flex flex-col gap-2 rounded-lg border border-border/70 bg-surface p-3">
          <div class="text-[10px] font-bold tracking-wider text-text-secondary uppercase">
            💬 Сообщение #2 ({{ previewLang.toUpperCase() }} HTML + Кнопка):
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div
            class="whitespace-pre-line text-xs leading-relaxed text-text-primary"
            v-html="currentPreviewItem.text"
          ></div>
          <div class="pt-1">
            <a
              :href="promoTargetUrl || '#'"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex w-full items-center justify-center rounded-md border border-brand/40 bg-brand/15 py-2 text-xs font-bold text-brand transition hover:bg-brand hover:text-on-brand"
            >
              {{ currentPreviewItem.button }}
            </a>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          :disabled="!parsedPromoJson.ok || !isPromoDirty || isSavingPromo || isSendingPromo"
          class="min-w-0 flex-1 truncate rounded-lg border px-3 py-2.5 text-xs font-bold transition"
          :class="
            parsedPromoJson.ok && isPromoDirty
              ? 'border-brand bg-brand/15 text-brand hover:bg-brand hover:text-on-brand'
              : 'border-border bg-elevated text-text-secondary opacity-60 cursor-default'
          "
          @click="submitPromoCampaign(false)"
        >
          {{ isPromoDirty ? "💾 Сохранить" : "✓ Сохранено" }}
        </button>

        <button
          type="button"
          :disabled="!parsedPromoJson.ok || isSendingPromo || isSavingPromo"
          class="min-w-0 flex-1 truncate rounded-lg bg-accent px-3 py-2.5 text-xs font-bold text-on-brand transition hover:bg-accent-deep disabled:opacity-50"
          @click="submitPromoCampaign(true)"
        >
          📢 Разослать
        </button>
      </div>
    </section>
  </div>
</template>
