<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  DEFAULT_PROMO_FILE_ID,
  DEFAULT_PROMO_TRANSLATIONS,
  parseAndValidatePromoTranslationsJson,
  type AppLanguage,
  type PromoCampaignDTO,
  type PromoTranslationsPayload,
} from "shared";

const props = defineProps<{
  latestPromo: PromoCampaignDTO | null;
  isSavingPromo: boolean;
  isSendingPromo: boolean;
}>();

const emit = defineEmits<{
  submitPromo: [
    payload: {
      title: string;
      fileId: string;
      targetUrl: string;
      translations: PromoTranslationsPayload;
      broadcastNow: boolean;
    },
  ];
}>();

const promoTitle = ref("ExtraPawn Main App Promo");
const promoFileId = ref(DEFAULT_PROMO_FILE_ID);
const promoTargetUrl = ref("https://extrapawn.com");
const copyNotice = ref<string | null>(null);
const previewLang = ref<AppLanguage>("ru");

function formatTranslationsJson(payload: PromoTranslationsPayload): string {
  return JSON.stringify(payload, null, 2);
}

const promoJsonText = ref<string>(
  formatTranslationsJson(DEFAULT_PROMO_TRANSLATIONS)
);
const savedPromoSnapshot = ref<string>("");

function buildCurrentPromoSnapshot(): string {
  return JSON.stringify({
    title: promoTitle.value.trim(),
    file_id: promoFileId.value.trim(),
    target_url: promoTargetUrl.value.trim(),
    json: promoJsonText.value.trim(),
  });
}

function hydrateFromPromo(latest: PromoCampaignDTO | null) {
  if (!latest) {
    if (!savedPromoSnapshot.value) {
      savedPromoSnapshot.value = buildCurrentPromoSnapshot();
    }
    return;
  }

  promoTitle.value = latest.title || "ExtraPawn Main App Promo";
  promoFileId.value =
    latest.file_id || latest.image_url || DEFAULT_PROMO_FILE_ID;
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

watch(
  () => props.latestPromo,
  (next) => {
    hydrateFromPromo(next);
  },
  { immediate: true }
);

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

function handleSubmit(broadcastNow: boolean) {
  if (!parsedPromoJson.value.ok) return;
  emit("submitPromo", {
    title: promoTitle.value.trim() || "ExtraPawn Main App Promo",
    fileId: promoFileId.value.trim() || DEFAULT_PROMO_FILE_ID,
    targetUrl: promoTargetUrl.value.trim() || "https://extrapawn.com",
    translations: parsedPromoJson.value.data,
    broadcastNow,
  });
}
</script>

<template>
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
        @click="handleSubmit(false)"
      >
        {{ isPromoDirty ? "💾 Сохранить" : "✓ Сохранено" }}
      </button>

      <button
        type="button"
        :disabled="!parsedPromoJson.ok || isSendingPromo || isSavingPromo"
        class="min-w-0 flex-1 truncate rounded-lg bg-accent px-3 py-2.5 text-xs font-bold text-on-brand transition hover:bg-accent-deep disabled:opacity-50"
        @click="handleSubmit(true)"
      >
        📢 Разослать
      </button>
    </div>
  </section>
</template>
