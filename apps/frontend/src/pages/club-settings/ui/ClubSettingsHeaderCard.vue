<script setup lang="ts">
import type { ClubSummaryDTO } from "shared";
import { useI18n } from "@/shared/i18n/useI18n";

defineProps<{
  club: ClubSummaryDTO;
  isClubActive: boolean;
  isTogglingActive: boolean;
}>();

const emit = defineEmits<{
  back: [];
  toggleActive: [];
}>();

const { t } = useI18n();
</script>

<template>
  <section class="glass flex flex-col gap-3 p-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <button
          type="button"
          class="mb-1 text-[11px] font-semibold text-text-secondary transition hover:text-brand"
          @click="emit('back')"
        >
          ← {{ t("nav_cabinet") }}
        </button>
        <div class="text-xs font-bold tracking-wider text-brand uppercase">
          {{ t("settings_title") }}
        </div>
        <h1 class="mt-0.5 text-base font-bold text-text-primary">
          {{ club.title }} (Topic #{{ club.topic_thread_id }})
        </h1>
      </div>

      <!-- Master Toggle Switch (active: true / false) -->
      <button
        v-if="club.status !== 'blocked'"
        type="button"
        :disabled="isTogglingActive"
        class="flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition"
        :class="
          isClubActive
            ? 'border-brand bg-brand/15 text-brand'
            : 'border-border bg-elevated text-text-secondary'
        "
        @click="emit('toggleActive')"
      >
        <span
          class="relative inline-flex h-5 w-9 items-center rounded-full transition"
          :class="isClubActive ? 'bg-brand' : 'bg-border'"
        >
          <span
            class="inline-block h-3.5 w-3.5 transform rounded-full bg-on-brand transition"
            :class="isClubActive ? 'translate-x-4.5' : 'translate-x-1'"
          ></span>
        </span>
        <span>
          {{
            isClubActive
              ? t("settings_bot_active")
              : t("settings_bot_paused")
          }}
        </span>
      </button>
    </div>

    <!-- Smart Auto-Pause Notice -->
    <div
      v-if="club.auto_paused && isClubActive && club.status !== 'blocked'"
      class="rounded-lg border border-warning/40 bg-warning/15 px-3 py-2 text-xs text-warning"
    >
      ⏸ <strong>{{ t("settings_auto_paused_badge") }}</strong> — {{ t("settings_auto_paused_desc") }}
    </div>

    <!-- Blocked Club Notice with @ProfessorMozer link & QR Code -->
    <div
      v-if="club.status === 'blocked'"
      class="flex flex-col items-center gap-3 rounded-xl border border-danger/50 bg-danger/15 p-4 text-center"
    >
      <div class="text-sm font-bold text-danger">
        ⛔ {{ t("settings_blocked_title") }}
      </div>
      <p class="text-xs text-text-primary">
        {{ t("settings_blocked_desc") }}
        <a
          href="https://t.me/ProfessorMozer"
          target="_blank"
          rel="noopener noreferrer"
          class="font-bold text-brand underline hover:opacity-80"
        >
          @ProfessorMozer
        </a>
      </p>
      <a
        href="https://t.me/ProfessorMozer"
        target="_blank"
        rel="noopener noreferrer"
        class="overflow-hidden rounded-xl border border-border bg-surface p-2 transition hover:border-brand"
      >
        <img
          src="/professor_mozer_qr.png"
          alt="@ProfessorMozer QR"
          class="h-40 w-40 object-contain"
        />
      </a>
    </div>
  </section>
</template>
