import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  DEFAULT_CLUB_CHAT_ID,
  MAX_OWNED_CLUBS_PER_USER,
  type AppLanguage,
  type ClubSummaryDTO,
  type UserCabinetDTO,
} from "shared";
import { apiRequest } from "@/shared/api/httpClient";
import { useI18n } from "@/shared/i18n/useI18n";

const TERMS_LOCAL_STORAGE_KEY = "extrapawn_mini_terms_accepted_v1";

export const useCabinetStore = defineStore("cabinet", () => {
  const data = ref<UserCabinetDTO | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const selectedChatId = ref<string>(DEFAULT_CLUB_CHAT_ID);
  const localTermsAccepted = ref<boolean>(
    typeof window !== "undefined" &&
      Boolean(window.localStorage.getItem(TERMS_LOCAL_STORAGE_KEY))
  );
  const { setLanguage } = useI18n();

  const currentUser = computed(() => data.value?.user ?? null);
  const isSuperadmin = computed(() => Boolean(data.value?.user.is_superadmin));
  const isTermsAccepted = computed(() => {
    if (data.value?.user) {
      return Boolean(data.value.user.terms_accepted_at);
    }
    return localTermsAccepted.value;
  });
  const history = computed(() => data.value?.history ?? []);
  const clubs = computed(() => data.value?.clubs ?? []);
  const myClubs = computed(
    () =>
      data.value?.my_clubs ??
      clubs.value.filter((c) => c.is_admin)
  );
  const ownedClubsCount = computed(() => data.value?.owned_clubs_count ?? 0);
  const maxOwnedClubs = computed(
    () => data.value?.max_owned_clubs ?? MAX_OWNED_CLUBS_PER_USER
  );
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
      if (res.user.terms_accepted_at) {
        localTermsAccepted.value = true;
        try {
          window.localStorage.setItem(
            TERMS_LOCAL_STORAGE_KEY,
            res.user.terms_accepted_at
          );
        } catch {
          // Ignore storage write error
        }
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

  async function toggleClubActive(
    chatId: string,
    nextActive: boolean
  ): Promise<ClubSummaryDTO | null> {
    try {
      const updated = await apiRequest<ClubSummaryDTO>(
        `/clubs/${encodeURIComponent(chatId)}/active`,
        {
          method: "PATCH",
          body: JSON.stringify({ is_active: nextActive }),
        }
      );
      if (data.value) {
        data.value.clubs = data.value.clubs.map((c) =>
          c.chat_id === chatId ? updated : c
        );
        data.value.my_clubs = data.value.my_clubs.map((c) =>
          c.chat_id === chatId ? updated : c
        );
      }
      return updated;
    } catch {
      return null;
    }
  }

  async function acceptTerms(): Promise<void> {
    const res = await apiRequest<{ ok: true; terms_accepted_at: string }>(
      "/cabinet/accept-terms",
      {
        method: "POST",
      }
    );
    localTermsAccepted.value = true;
    if (data.value?.user) {
      data.value.user.terms_accepted_at = res.terms_accepted_at;
    }
    try {
      window.localStorage.setItem(
        TERMS_LOCAL_STORAGE_KEY,
        res.terms_accepted_at
      );
    } catch {
      // Ignore storage write error
    }
  }

  return {
    data,
    isLoading,
    error,
    selectedChatId,
    currentUser,
    isSuperadmin,
    isTermsAccepted,
    history,
    clubs,
    myClubs,
    ownedClubsCount,
    maxOwnedClubs,
    selectedClub,
    fetchCabinet,
    changeLanguage,
    acceptTerms,
    toggleClubActive,
  };
});

