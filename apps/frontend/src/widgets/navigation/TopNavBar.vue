<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { DEFAULT_CLUB_CHAT_ID } from "shared";
import { useCabinetStore } from "@/entities/cabinet/model/cabinet.store";
import { useI18n } from "@/shared/i18n/useI18n";

const route = useRoute();
const router = useRouter();
const cabinetStore = useCabinetStore();
const { lang, t } = useI18n();

const activeChatId = computed(() => {
  const paramChatId = route.params.chatId;
  if (typeof paramChatId === "string" && paramChatId) {
    return paramChatId;
  }
  return cabinetStore.selectedChatId || DEFAULT_CLUB_CHAT_ID;
});

const canManageSelectedClub = computed(() => {
  const club = cabinetStore.clubs.find(
    (c) => c.chat_id === activeChatId.value
  );
  return Boolean(club?.is_admin || cabinetStore.isSuperadmin);
});

function toggleLanguage() {
  const next =
    lang.value === "ru" ? "en" : lang.value === "en" ? "de" : "ru";
  void cabinetStore.changeLanguage(next);
}
</script>

<template>
  <!-- Top Brand Header (Centered) -->
  <header class="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur-xs">
    <div class="mx-auto flex max-w-2xl items-center justify-center px-3 py-2.5">
      <button
        type="button"
        class="flex items-center gap-2"
        @click="router.push('/cabinet')"
      >
        <span class="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-sm font-black text-on-brand">
          ♟
        </span>
        <span class="brand-text text-sm tracking-wider">EXTRAPAWN</span>
      </button>
    </div>
  </header>

  <!-- Bottom Fixed Navigation Bar -->
  <nav
    class="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur-xs"
    style="padding-bottom: env(safe-area-inset-bottom, 0px)"
  >
    <div class="mx-auto flex max-w-2xl items-center justify-center gap-1 overflow-x-auto px-2 py-2">
      <button
        type="button"
        class="shrink-0 rounded-md px-2.5 py-1.5 text-xs font-semibold transition"
        :class="
          route.path === '/cabinet'
            ? 'bg-elevated text-brand border border-brand/40'
            : 'text-text-secondary hover:text-text-primary'
        "
        @click="router.push('/cabinet')"
      >
        {{ t("nav_cabinet") }}
      </button>

      <button
        type="button"
        class="shrink-0 rounded-md px-2.5 py-1.5 text-xs font-semibold transition"
        :class="
          route.path === '/clubs'
            ? 'bg-elevated text-brand border border-brand/40'
            : 'text-text-secondary hover:text-text-primary'
        "
        @click="router.push('/clubs')"
      >
        🏆 {{ t("nav_clubs") }}
      </button>

      <button
        type="button"
        class="shrink-0 rounded-md px-2.5 py-1.5 text-xs font-semibold transition"
        :class="
          route.path.startsWith('/challenge/records')
            ? 'bg-elevated text-brand border border-brand/40'
            : 'text-text-secondary hover:text-text-primary'
        "
        @click="
          router.push(
            `/challenge/records/${encodeURIComponent(activeChatId)}`
          )
        "
      >
        {{ t("nav_records") }}
      </button>

      <button
        v-if="canManageSelectedClub"
        type="button"
        class="shrink-0 rounded-md px-2.5 py-1.5 text-xs font-semibold transition"
        :class="
          route.path.startsWith('/club-settings')
            ? 'bg-elevated text-brand border border-brand/40'
            : 'text-text-secondary hover:text-text-primary'
        "
        @click="
          router.push(`/club-settings/${encodeURIComponent(activeChatId)}`)
        "
      >
        {{ t("nav_settings") }}
      </button>

      <button
        v-if="cabinetStore.isSuperadmin"
        type="button"
        class="shrink-0 rounded-md px-2.5 py-1.5 text-xs font-bold transition"
        :class="
          route.path === '/super-admin'
            ? 'bg-accent text-on-brand'
            : 'text-accent hover:bg-elevated'
        "
        @click="router.push('/super-admin')"
      >
        {{ t("nav_superadmin") }}
      </button>

      <button
        type="button"
        class="ml-1 shrink-0 rounded-md border border-border bg-elevated px-2 py-1 text-[11px] font-bold text-text-secondary uppercase transition hover:border-border-hover hover:text-text-primary"
        @click="toggleLanguage"
      >
        {{ lang }}
      </button>
    </div>
  </nav>
</template>

