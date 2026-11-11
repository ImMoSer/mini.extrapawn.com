<script setup lang="ts">
import { onMounted } from "vue";
import { RouterView, useRouter } from "vue-router";
import { useCabinetStore } from "@/entities/cabinet/model/cabinet.store";
import {
  getInitialDeepLinkRoute,
  initTelegramWebApp,
} from "@/shared/lib/telegram";
import FirstLaunchConsentModal from "@/widgets/consent/FirstLaunchConsentModal.vue";
import TopNavBar from "@/widgets/navigation/TopNavBar.vue";

const router = useRouter();
const cabinetStore = useCabinetStore();

onMounted(async () => {
  initTelegramWebApp();
  await cabinetStore.fetchCabinet();

  const deepLinkRoute = getInitialDeepLinkRoute();
  if (deepLinkRoute && router.currentRoute.value.path === "/cabinet") {
    await router.replace(deepLinkRoute);
  }
});
</script>

<template>
  <div class="min-h-screen bg-canvas text-text-primary">
    <TopNavBar />
    <main class="pb-20">
      <RouterView />
    </main>
    <FirstLaunchConsentModal />
  </div>
</template>

