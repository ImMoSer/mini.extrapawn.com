<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { useCabinetStore } from "@/entities/cabinet/model/cabinet.store";
import { useI18n } from "@/shared/i18n/useI18n";

const route = useRoute();
const router = useRouter();
const cabinetStore = useCabinetStore();
const { lang, t } = useI18n();

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

  <!-- Bottom Fixed Navigation Bar: Кабинет | 🏆 Клубы | BOSS | RU -->
  <nav
    class="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur-xs"
    style="padding-bottom: env(safe-area-inset-bottom, 0px)"
  >
    <div class="mx-auto flex max-w-2xl items-center justify-center gap-2 overflow-x-auto px-3 py-2">
      <button
        type="button"
        class="shrink-0 rounded-md px-3.5 py-1.5 text-xs font-semibold transition"
        :class="
          route.path === '/cabinet' || route.path.startsWith('/club-settings')
            ? 'bg-elevated text-brand border border-brand/40'
            : 'text-text-secondary hover:text-text-primary'
        "
        @click="router.push('/cabinet')"
      >
        {{ t("nav_cabinet") }}
      </button>

      <button
        type="button"
        class="shrink-0 rounded-md px-3.5 py-1.5 text-xs font-semibold transition"
        :class="
          route.path === '/clubs' || route.path.startsWith('/challenge/records')
            ? 'bg-elevated text-brand border border-brand/40'
            : 'text-text-secondary hover:text-text-primary'
        "
        @click="router.push('/clubs')"
      >
        🏆 {{ t("nav_clubs") }}
      </button>

      <button
        type="button"
        class="shrink-0 rounded-md px-3.5 py-1.5 text-xs font-black tracking-wider transition"
        :class="
          route.path === '/go'
            ? 'bg-info text-on-brand shadow-xs'
            : 'border border-info/40 bg-info/10 text-info hover:bg-info/20'
        "
        @click="router.push('/go')"
      >
        GO
      </button>

      <button
        v-if="cabinetStore.isSuperadmin"
        type="button"
        class="shrink-0 rounded-md px-3 py-1.5 text-xs font-bold transition"
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
        class="ml-1 shrink-0 rounded-md border border-border bg-elevated px-2.5 py-1 text-[11px] font-bold text-text-secondary uppercase transition hover:border-border-hover hover:text-text-primary"
        @click="toggleLanguage"
      >
        {{ lang }}
      </button>
    </div>
  </nav>
</template>

