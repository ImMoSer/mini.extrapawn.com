<script setup lang="ts">
import { computed, ref } from "vue";
import {
  LEGAL_IMPRINT_URL,
  LEGAL_PRIVACY_URL,
  LEGAL_TERMS_URL,
  type AppLanguage,
} from "shared";
import { useCabinetStore } from "@/entities/cabinet/model/cabinet.store";
import { useI18n } from "@/shared/i18n/useI18n";
import { openTelegramUrl } from "@/shared/lib/telegram";

const cabinetStore = useCabinetStore();
const { lang, t } = useI18n();

const isAccepted = ref(false);
const isSaving = ref(false);

const shouldShow = computed(() => {
  if (cabinetStore.isLoading && !cabinetStore.data) return false;
  if (!cabinetStore.data) return false;
  return !cabinetStore.isTermsAccepted;
});

function selectLang(next: AppLanguage) {
  void cabinetStore.changeLanguage(next);
}

async function handleConfirm() {
  if (!isAccepted.value || isSaving.value) return;
  isSaving.value = true;
  try {
    await cabinetStore.acceptTerms();
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="shouldShow"
      class="fixed inset-0 z-50 flex items-center justify-center bg-canvas/90 p-3 backdrop-blur-xs"
    >
      <div
        class="glass flex max-h-[92vh] w-full max-w-md flex-col gap-3.5 overflow-y-auto p-4 text-text-primary shadow-lg"
      >
        <!-- Header + Language Pills -->
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2">
            <span
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand text-sm font-black text-on-brand"
            >
              ♟
            </span>
            <div>
              <h2 class="text-sm font-bold text-text-primary">
                {{ t("consent_title") }}
              </h2>
              <p class="text-[11px] leading-snug text-text-secondary">
                {{ t("consent_subtitle") }}
              </p>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <button
              v-for="l in (['ru', 'en', 'de'] as const)"
              :key="l"
              type="button"
              class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase transition"
              :class="
                lang === l
                  ? 'bg-brand text-on-brand'
                  : 'border border-border bg-elevated text-text-secondary hover:text-text-primary'
              "
              @click="selectLang(l)"
            >
              {{ l }}
            </button>
          </div>
        </div>

        <!-- 3 Concise Points -->
        <div class="flex flex-col gap-2">
          <div class="rounded-lg border border-border bg-elevated p-2.5">
            <div class="text-xs font-bold text-text-primary">
              {{ t("consent_p1_title") }}
            </div>
            <p class="mt-0.5 text-[11px] leading-relaxed text-text-secondary">
              {{ t("consent_p1_text") }}
            </p>
          </div>

          <div class="rounded-lg border border-border bg-elevated p-2.5">
            <div class="text-xs font-bold text-text-primary">
              {{ t("consent_p2_title") }}
            </div>
            <p class="mt-0.5 text-[11px] leading-relaxed text-text-secondary">
              {{ t("consent_p2_text") }}
            </p>
          </div>

          <div class="rounded-lg border border-border bg-elevated p-2.5">
            <div class="text-xs font-bold text-text-primary">
              {{ t("consent_p3_title") }}
            </div>
            <p class="mt-0.5 text-[11px] leading-relaxed text-text-secondary">
              {{ t("consent_p3_text") }}
            </p>
          </div>
        </div>

        <!-- Checkbox with Legal Links -->
        <label
          class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-elevated p-3 text-xs leading-relaxed text-text-secondary"
        >
          <input
            v-model="isAccepted"
            type="checkbox"
            class="mt-0.5 h-4 w-4 shrink-0 accent-brand"
          />
          <span>
            {{ t("consent_check_prefix") }}
            <button
              type="button"
              class="font-semibold text-brand underline hover:opacity-80"
              @click.stop="openTelegramUrl(LEGAL_TERMS_URL)"
            >
              {{ t("consent_terms_link") }}
            </button>
            {{ t("consent_check_mid") }}
            <button
              type="button"
              class="font-semibold text-brand underline hover:opacity-80"
              @click.stop="openTelegramUrl(LEGAL_PRIVACY_URL)"
            >
              {{ t("consent_privacy_link") }}
            </button>
            <template v-if="t('consent_check_suffix')">
              {{ " " + t("consent_check_suffix") }}
            </template>
            (<button
              type="button"
              class="text-brand underline hover:opacity-80"
              @click.stop="openTelegramUrl(LEGAL_IMPRINT_URL)"
            >{{ t("consent_imprint_link") }}</button>).
          </span>
        </label>

        <!-- Continue Button -->
        <button
          type="button"
          :disabled="!isAccepted || isSaving"
          class="w-full rounded-lg py-2.5 text-sm font-bold transition"
          :class="
            isAccepted && !isSaving
              ? 'cursor-pointer bg-brand text-on-brand hover:bg-brand-deep'
              : 'cursor-not-allowed border border-border bg-elevated text-text-disabled'
          "
          @click="handleConfirm"
        >
          {{ t("consent_continue_btn") }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

