<script setup lang="ts">
import { onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ChallengeAttemptRefDTO, ReplaySpeedMode } from "shared";
import { apiRequest } from "@/shared/api/httpClient";
import { useI18n } from "@/shared/i18n/useI18n";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

onMounted(async () => {
  const attemptId = String(route.params.attemptId || "").trim();
  const rawSpeed = String(route.params.speed || "fast");
  const speed: ReplaySpeedMode = rawSpeed === "game" ? "game" : "fast";

  if (!attemptId) {
    await router.replace("/go");
    return;
  }

  try {
    const ref = await apiRequest<ChallengeAttemptRefDTO>(
      `/challenges/attempt-ref/${encodeURIComponent(attemptId)}`
    );
    await router.replace(
      `/challenge/${ref.discipline}/${encodeURIComponent(
        ref.puzzle_id
      )}/${encodeURIComponent(ref.edition)}/${encodeURIComponent(
        ref.chat_id
      )}/${encodeURIComponent(ref.telegram_id)}?speed=${speed}`
    );
  } catch (err) {
    console.error("[ReplayRedirectPage] Failed to resolve attempt ref:", err);
    await router.replace("/go");
  }
});
</script>

<template>
  <div class="mx-auto flex max-w-2xl items-center justify-center px-3 py-12">
    <div class="glass px-4 py-3 text-xs font-semibold text-text-secondary">
      ⏳ {{ t("go_loading") }}
    </div>
  </div>
</template>
