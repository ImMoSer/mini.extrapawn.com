<script setup lang="ts">
import {
  BUY_ME_A_COFFEE_URL,
  DEVELOPER_TG_URL,
  EXTRAPAWN_WEB_URL,
  GITHUB_MAIN_REPO_URL,
  GITHUB_MINI_REPO_URL,
  LEELA_NETS_REPO_URL,
  LEGAL_IMPRINT_URL,
  LEGAL_PRIVACY_URL,
  LEGAL_TERMS_URL,
} from "shared";
import { useI18n } from "@/shared/i18n/useI18n";
import { openTelegramUrl } from "@/shared/lib/telegram";

const { t } = useI18n();
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4 px-3 py-4">
    <!-- Hero Header -->
    <section class="glass flex flex-col gap-1.5 p-4">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-bold tracking-wider text-brand uppercase">
          ℹ️ {{ t("about_title") }}
        </span>
        <span
          class="rounded bg-elevated px-2 py-0.5 text-[11px] font-semibold text-success"
        >
          100% FREE
        </span>
      </div>
      <p class="text-xs leading-relaxed text-text-secondary">
        {{ t("about_subtitle") }}
      </p>
    </section>

    <!-- 1. About ExtraPawn Challenges -->
    <section class="glass flex flex-col gap-3 p-4">
      <h2 class="text-xs font-bold tracking-wider text-text-primary uppercase">
        {{ t("about_sec1_title") }}
      </h2>
      <p class="text-xs leading-relaxed text-text-secondary">
        {{ t("about_sec1_p1") }}
      </p>
      <p class="text-xs leading-relaxed text-text-secondary">
        {{ t("about_sec1_p2") }}
      </p>
      <button
        type="button"
        class="w-full rounded-lg border border-brand/50 bg-brand/15 px-3 py-2.5 text-xs font-bold text-brand transition hover:bg-brand hover:text-on-brand"
        @click="openTelegramUrl(EXTRAPAWN_WEB_URL)"
      >
        {{ t("about_web_cta") }}
      </button>
    </section>

    <!-- 2. Plain-Language Rules & Privacy -->
    <section class="glass flex flex-col gap-2.5 p-4">
      <h2 class="text-xs font-bold tracking-wider text-text-primary uppercase">
        {{ t("about_sec2_title") }}
      </h2>
      <div class="flex flex-col gap-2 text-xs leading-relaxed text-text-secondary">
        <p>{{ t("about_sec2_p1") }}</p>
        <p>{{ t("about_sec2_p2") }}</p>
        <p>{{ t("about_sec2_p3") }}</p>
      </div>
    </section>

    <!-- 3. Open Source & Credits (GPLv3 compliance) -->
    <section class="glass flex flex-col gap-3 p-4">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-xs font-bold tracking-wider text-text-primary uppercase">
          {{ t("about_sec3_title") }}
        </h2>
        <span class="rounded bg-elevated px-2 py-0.5 font-mono text-[10px] font-bold text-brand">
          GNU GPLv3
        </span>
      </div>

      <p class="text-xs leading-relaxed text-text-secondary">
        {{ t("about_sec3_p1") }}
      </p>

      <!-- Source Code Repository Links -->
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          class="rounded-lg border border-brand/40 bg-elevated px-3 py-2 text-xs font-bold text-brand transition hover:border-brand"
          @click="openTelegramUrl(GITHUB_MINI_REPO_URL)"
        >
          {{ t("about_repo_mini_btn") }}
        </button>
        <button
          type="button"
          class="rounded-lg border border-border bg-elevated px-3 py-2 text-xs font-bold text-text-primary transition hover:border-brand hover:text-brand"
          @click="openTelegramUrl(GITHUB_MAIN_REPO_URL)"
        >
          {{ t("about_repo_main_btn") }}
        </button>
      </div>

      <!-- 4 Detailed Credit Blocks (matching extrapawn.com) -->
      <div class="flex flex-col gap-2">
        <div class="rounded-lg border border-border bg-elevated p-3">
          <div class="text-xs font-bold text-text-primary">
            {{ t("about_sec3_sf_title") }}
          </div>
          <p class="mt-1 text-xs leading-relaxed text-text-secondary">
            {{ t("about_sec3_sf_desc") }}
          </p>
        </div>

        <div class="rounded-lg border border-border bg-elevated p-3">
          <div class="text-xs font-bold text-brand">
            {{ t("about_sec3_mozero_title") }}
          </div>
          <p class="mt-1 text-xs leading-relaxed text-text-secondary">
            {{ t("about_sec3_mozero_desc") }}
          </p>
          <button
            type="button"
            class="mt-2 inline-flex items-center rounded border border-border bg-surface px-2.5 py-1 text-[11px] font-bold text-text-primary transition hover:border-brand hover:text-brand"
            @click="openTelegramUrl(LEELA_NETS_REPO_URL)"
          >
            {{ t("about_repo_leela_btn") }}
          </button>
        </div>

        <div class="rounded-lg border border-border bg-elevated p-3">
          <div class="text-xs font-bold text-text-primary">
            {{ t("about_sec3_lczero_title") }}
          </div>
          <p class="mt-1 text-xs leading-relaxed text-text-secondary">
            {{ t("about_sec3_lczero_desc") }}
          </p>
        </div>

        <div class="rounded-lg border border-border bg-elevated p-3">
          <div class="text-xs font-bold text-text-primary">
            {{ t("about_sec3_lichess_title") }}
          </div>
          <p class="mt-1 text-xs leading-relaxed text-text-secondary">
            {{ t("about_sec3_lichess_desc") }}
          </p>
        </div>
      </div>
    </section>

    <!-- 4. Voluntary Support (Donate & Contact) -->
    <section class="glass flex flex-col gap-3 p-4">
      <h2 class="text-xs font-bold tracking-wider text-brand uppercase">
        {{ t("about_sec4_title") }}
      </h2>
      <p class="text-xs leading-relaxed text-text-secondary">
        {{ t("about_sec4_desc") }}
      </p>
      <div class="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          class="flex-1 rounded-lg bg-brand px-3 py-2.5 text-xs font-bold text-on-brand transition hover:bg-brand-deep"
          @click="openTelegramUrl(BUY_ME_A_COFFEE_URL)"
        >
          {{ t("about_donate_btn") }}
        </button>
        <button
          type="button"
          class="rounded-lg border border-border bg-elevated px-3 py-2.5 text-xs font-bold text-text-primary transition hover:border-brand"
          @click="openTelegramUrl(DEVELOPER_TG_URL)"
        >
          {{ t("about_contact_btn") }}
        </button>
      </div>
    </section>

    <!-- 5. Official Legal Documents -->
    <section class="glass flex flex-col gap-2.5 p-4">
      <h2 class="text-xs font-bold tracking-wider text-text-secondary uppercase">
        {{ t("about_sec5_title") }}
      </h2>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          type="button"
          class="rounded-lg border border-border bg-elevated px-3 py-2 text-xs font-semibold text-text-primary transition hover:border-brand hover:text-brand"
          @click="openTelegramUrl(LEGAL_IMPRINT_URL)"
        >
          {{ t("about_link_imprint") }} ↗
        </button>
        <button
          type="button"
          class="rounded-lg border border-border bg-elevated px-3 py-2 text-xs font-semibold text-text-primary transition hover:border-brand hover:text-brand"
          @click="openTelegramUrl(LEGAL_PRIVACY_URL)"
        >
          {{ t("about_link_privacy") }} ↗
        </button>
        <button
          type="button"
          class="rounded-lg border border-border bg-elevated px-3 py-2 text-xs font-semibold text-text-primary transition hover:border-brand hover:text-brand"
          @click="openTelegramUrl(LEGAL_TERMS_URL)"
        >
          {{ t("about_link_terms") }} ↗
        </button>
      </div>
    </section>
  </div>
</template>

