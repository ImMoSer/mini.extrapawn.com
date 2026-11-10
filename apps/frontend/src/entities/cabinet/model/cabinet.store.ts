import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  DEFAULT_CLUB_CHAT_ID,
  type AppLanguage,
  type UserCabinetDTO,
} from "shared";
import { apiRequest } from "@/shared/api/httpClient";
import { useI18n } from "@/shared/i18n/useI18n";

export const useCabinetStore = defineStore("cabinet", () => {
  const data = ref<UserCabinetDTO | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const selectedChatId = ref<string>(DEFAULT_CLUB_CHAT_ID);
  const { setLanguage } = useI18n();

  const currentUser = computed(() => data.value?.user ?? null);
  const isSuperadmin = computed(() => Boolean(data.value?.user.is_superadmin));
  const clubs = computed(() => data.value?.clubs ?? []);
  const selectedClub = computed(
    () =>
      clubs.value.find((c) => c.chat_id === selectedChatId.value) ??
      clubs.value[0] ??
      null
  );

  async function fetchCabinet(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      const res = await apiRequest<UserCabinetDTO>("/cabinet");
      data.value = res;
      if (res.user.language_code) {
        setLanguage(res.user.language_code);
      }
      if (
        !res.clubs.some((c) => c.chat_id === selectedChatId.value) &&
        res.default_chat_id
      ) {
        selectedChatId.value = res.default_chat_id;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      isLoading.value = false;
    }
  }

  async function changeLanguage(next: AppLanguage): Promise<void> {
    setLanguage(next);
    if (data.value) {
      data.value.user.language_code = next;
    }
    try {
      await apiRequest("/cabinet/language", {
        method: "PATCH",
        body: JSON.stringify({ language_code: next }),
      });
    } catch {
      // Ignore background language sync failure
    }
  }

  return {
    data,
    isLoading,
    error,
    selectedChatId,
    currentUser,
    isSuperadmin,
    clubs,
    selectedClub,
    fetchCabinet,
    changeLanguage,
  };
});

