<script setup lang="ts">
import type { ClubSummaryDTO } from "shared";

defineProps<{
  clubs: ClubSummaryDTO[];
  busyClubId: string | null;
}>();

const emit = defineEmits<{
  approve: [club: ClubSummaryDTO];
  reject: [club: ClubSummaryDTO];
  triggerChallenge: [club: ClubSummaryDTO];
  openSettings: [club: ClubSummaryDTO];
  toggleBlacklist: [club: ClubSummaryDTO, blocked: boolean];
  purgeData: [club: ClubSummaryDTO];
}>();
</script>

<template>
  <section class="glass flex flex-col gap-3 p-4">
    <h2 class="text-xs font-bold tracking-wider text-text-secondary uppercase">
      ЗАЯВКИ И УПРАВЛЕНИЕ КЛУБАМИ
    </h2>

    <div class="flex flex-col divide-y divide-border">
      <div
        v-for="club in clubs"
        :key="club.chat_id"
        class="flex flex-col gap-2.5 py-3"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="truncate text-sm font-bold text-text-primary">
                {{ club.title }}
              </span>

              <!-- Status Badges -->
              <span
                v-if="club.status === 'pending'"
                class="rounded bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning uppercase"
              >
                ⏳ ЗАЯВКА
              </span>
              <span
                v-else
                class="rounded px-2 py-0.5 text-[10px] font-bold uppercase"
                :class="
                  club.status === 'blocked'
                    ? 'bg-danger/15 text-danger'
                    : 'bg-success/15 text-success'
                "
              >
                {{ club.status === "blocked" ? "⛔ BLACKLIST" : "✓ LEGIT" }}
              </span>

              <span
                v-if="club.status !== 'blocked' && club.status !== 'pending'"
                class="rounded px-2 py-0.5 text-[10px] font-bold uppercase"
                :class="
                  club.status === 'bot_removed'
                    ? 'bg-warning/15 text-warning'
                    : club.is_active
                      ? 'bg-brand/15 text-brand'
                      : 'bg-elevated text-text-secondary'
                "
              >
                {{
                  club.status === "bot_removed"
                    ? "BOT REMOVED"
                    : club.is_active
                      ? "ACTIVE"
                      : "PAUSED BY ADMIN"
                }}
              </span>
            </div>

            <div class="font-condensed text-xs text-text-secondary">
              <span v-if="club.username" class="text-brand">@{{ club.username }} • </span>
              chat_id: {{ club.chat_id }} • owner: {{ club.owner_telegram_id }} •
              thread: #{{ club.topic_thread_id }} • members:
              {{ club.member_count }} • challenges:
              {{ club.published_challenges_count }}
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <!-- 1-Click Approval / Rejection for Pending Applications -->
            <template v-if="club.status === 'pending'">
              <button
                type="button"
                :disabled="busyClubId === club.chat_id"
                class="min-w-0 truncate rounded bg-success px-2.5 py-1 text-xs font-bold text-on-brand transition hover:opacity-90 disabled:opacity-50"
                @click="emit('approve', club)"
              >
                ✅ Одобрить
              </button>

              <button
                type="button"
                :disabled="busyClubId === club.chat_id"
                class="min-w-0 truncate rounded border border-warning/50 bg-warning/15 px-2.5 py-1 text-xs font-bold text-warning transition hover:bg-warning hover:text-on-brand disabled:opacity-50"
                @click="emit('reject', club)"
              >
                🚫 Отклонить
              </button>
            </template>

            <button
              v-if="club.status !== 'blocked' && club.status !== 'pending'"
              type="button"
              :disabled="busyClubId === club.chat_id"
              class="min-w-0 truncate rounded border border-border bg-elevated px-2.5 py-1 text-xs font-bold text-brand hover:border-brand disabled:opacity-50"
              @click="emit('triggerChallenge', club)"
            >
              🚀 Пост
            </button>

            <button
              type="button"
              class="min-w-0 truncate rounded border border-border bg-elevated px-2.5 py-1 text-xs font-bold text-text-primary hover:border-brand"
              @click="emit('openSettings', club)"
            >
              ⚙️ Настройки
            </button>

            <button
              v-if="club.status !== 'blocked'"
              type="button"
              :disabled="busyClubId === club.chat_id"
              class="min-w-0 truncate rounded bg-danger px-2.5 py-1 text-xs font-bold text-on-brand transition hover:opacity-90 disabled:opacity-50"
              @click="emit('toggleBlacklist', club, true)"
            >
              ⛔ Блок
            </button>

            <button
              v-if="club.status === 'blocked'"
              type="button"
              :disabled="busyClubId === club.chat_id"
              class="min-w-0 truncate rounded bg-success px-2.5 py-1 text-xs font-bold text-on-brand transition hover:opacity-90 disabled:opacity-50"
              @click="emit('toggleBlacklist', club, false)"
            >
              ✓ Разблок
            </button>

            <button
              type="button"
              :disabled="busyClubId === club.chat_id"
              class="min-w-0 truncate rounded border border-danger/50 bg-danger/15 px-2.5 py-1 text-xs font-bold text-danger transition hover:bg-danger hover:text-on-brand disabled:opacity-50"
              @click="emit('purgeData', club)"
            >
              🗑 Удалить
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
