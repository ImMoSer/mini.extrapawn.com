import { and, eq, lt, ne } from "drizzle-orm";
import { normalizeWeeklySchedule } from "shared";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { db } from "../db/index.js";
import { challengeAttempts, clubChallenges, clubs } from "../db/schema.js";
import {
  syncClubAdminsFromTelegram,
  verifyBotHasClubPermissions,
} from "./botAdminSync.js";
import {
  clearAutoPause,
  findLatestUnresolvedChallenge,
  notifyAutoPauseReplyOnce,
} from "./botAutoPause.js";
import { publishChallengeToClub } from "./botChallengePublisher.js";
import {
  handleChatMemberUpdate,
  handleMyChatMemberUpdate,
} from "./botClubOnboarding.js";
import { leaveClubChat } from "./botIncidents.js";
import {
  BOT_ONBOARDING_TEXTS,
  getClubZonedTime,
  resolveUserLanguage,
} from "./botTexts.js";
import type { TelegramUpdate } from "./botTypes.js";
import { handleSuperadminModerationCallback } from "./clubModeration.js";
import {
  callTelegramJson,
  deleteTelegramMessage,
  describeNetworkError,
} from "./telegramApi.js";

let pollingActive = false;
let lastUpdateOffset = 0;
let consecutivePollErrors = 0;

const POLL_BASE_DELAY_MS = 2_000;
const POLL_CONFLICT_DELAY_MS = 30_000;
const POLL_MAX_BACKOFF_MS = 30_000;

function computePollRetryDelayMs(errorCount: number): number {
  if (errorCount <= 0) return POLL_BASE_DELAY_MS;
  const exponent = Math.min(errorCount - 1, 4); // 2s -> 4s -> 8s -> 16s -> 30s
  return Math.min(POLL_BASE_DELAY_MS * 2 ** exponent, POLL_MAX_BACKOFF_MS);
}

async function pollTelegramUpdatesOnce(): Promise<number> {
  if (!env.TELEGRAM_BOT_TOKEN) return POLL_BASE_DELAY_MS;
  try {
    const res = await callTelegramJson<TelegramUpdate[]>("getUpdates", {
      offset: lastUpdateOffset,
      timeout: 15,
      allowed_updates: [
        "message",
        "my_chat_member",
        "chat_member",
        "callback_query",
      ],
    });
    if (!res.ok) {
      if (res.error_code === 409) {
        logger.warn(
          { event: "telegram_polling_conflict" },
          "409 Conflict on getUpdates (another instance is polling); backing off 30s"
        );
        return POLL_CONFLICT_DELAY_MS;
      }
      consecutivePollErrors += 1;
      const nextDelayMs = computePollRetryDelayMs(consecutivePollErrors);
      if (consecutivePollErrors === 3 || consecutivePollErrors % 10 === 0) {
        logger.warn(
          {
            event: "telegram_polling_api_error",
            consecutiveErrors: consecutivePollErrors,
            retryInSec: Math.round(nextDelayMs / 1000),
            error: res.description ?? `HTTP ${res.error_code ?? "unknown"}`,
          },
          "Telegram polling API error"
        );
      }
      return nextDelayMs;
    }

    if (consecutivePollErrors >= 3) {
      logger.info(
        {
          event: "telegram_polling_restored",
          previousErrors: consecutivePollErrors,
        },
        "Telegram long-polling restored"
      );
    }
    consecutivePollErrors = 0;

    if (!res.result) return POLL_BASE_DELAY_MS;

    for (const upd of res.result) {
      lastUpdateOffset = Math.max(lastUpdateOffset, upd.update_id + 1);
      if (upd.callback_query) {
        await handleSuperadminModerationCallback(upd.callback_query, {
          verifyBotHasClubPermissions: (id, lang) =>
            verifyBotHasClubPermissions(id, lang),
          publishChallengeToClub: (id) => publishChallengeToClub(id),
          leaveClubChat: (id, msg) => leaveClubChat(id, msg),
          clearAutoPause: (id) => clearAutoPause(id),
        });
      } else if (upd.my_chat_member) {
        await handleMyChatMemberUpdate(upd.my_chat_member);
      } else if (upd.chat_member) {
        await handleChatMemberUpdate(upd.chat_member);
      } else if (
        upd.message?.chat.type === "private" &&
        upd.message.text?.startsWith("/start")
      ) {
        const senderId = String(upd.message.from?.id ?? upd.message.chat.id);
        const userLang = await resolveUserLanguage(
          senderId,
          upd.message.from?.language_code
        );
        const startTexts = BOT_ONBOARDING_TEXTS[userLang];
        await callTelegramJson("sendMessage", {
          chat_id: String(upd.message.chat.id),
          parse_mode: "HTML",
          text: startTexts.privateStartText,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: startTexts.privateStartBtn,
                  url: `https://t.me/${env.BOT_USERNAME}?startapp=cabinet`,
                },
              ],
            ],
          },
        });
      }
    }
    return POLL_BASE_DELAY_MS;
  } catch (err) {
    consecutivePollErrors += 1;
    const nextDelayMs = computePollRetryDelayMs(consecutivePollErrors);
    if (consecutivePollErrors === 3 || consecutivePollErrors % 10 === 0) {
      logger.warn(
        {
          event: "telegram_polling_network_error",
          consecutiveErrors: consecutivePollErrors,
          retryInSec: Math.round(nextDelayMs / 1000),
          error: describeNetworkError(err),
        },
        "Telegram polling network error"
      );
    }
    return nextDelayMs;
  }
}

let lastSevenDayCleanupAt = 0;
let lastClubAdminsReconcileAt = 0;

async function reconcileConnectedClubsAdminsPeriodically(): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const nowMs = Date.now();
  const thirtyMinutesMs = 30 * 60 * 1000;
  if (nowMs - lastClubAdminsReconcileAt < thirtyMinutesMs) return;
  lastClubAdminsReconcileAt = nowMs;

  try {
    const connectedClubs = await db
      .select()
      .from(clubs)
      .where(
        and(ne(clubs.status, "blocked"), ne(clubs.status, "bot_removed"))
      );

    for (const club of connectedClubs) {
      if (!club.chatId.startsWith("-100")) continue;
      try {
        await syncClubAdminsFromTelegram(club.chatId);
        const countRes = await callTelegramJson<number>("getChatMemberCount", {
          chat_id: club.chatId,
        });
        if (countRes.ok && typeof countRes.result === "number") {
          await db
            .update(clubs)
            .set({ memberCount: countRes.result })
            .where(eq(clubs.chatId, club.chatId));
        }
      } catch (err) {
        logger.warn(
          {
            event: "club_admin_sync_warn",
            chatId: club.chatId,
            error: err instanceof Error ? err.message : String(err),
          },
          "Periodic club admin sync warning"
        );
      }
    }
  } catch (err) {
    logger.error(
      { event: "club_admin_reconcile_error", err },
      "Periodic club admin reconcile error"
    );
  }
}

async function purgeExpiredSevenDayRecords(): Promise<void> {
  const nowMs = Date.now();
  const oneHourMs = 60 * 60 * 1000;
  if (nowMs - lastSevenDayCleanupAt < oneHourMs) return;
  lastSevenDayCleanupAt = nowMs;

  const cutoffDate = new Date(nowMs - 7 * 24 * 60 * 60 * 1000);
  try {
    const deletedAttempts = await db
      .delete(challengeAttempts)
      .where(lt(challengeAttempts.updatedAt, cutoffDate))
      .returning({ id: challengeAttempts.id });
    const deletedChallenges = await db
      .delete(clubChallenges)
      .where(lt(clubChallenges.publishedAt, cutoffDate))
      .returning({ id: clubChallenges.id });
    if (deletedAttempts.length > 0 || deletedChallenges.length > 0) {
      logger.info(
        {
          event: "retention_cleanup",
          deletedAttempts: deletedAttempts.length,
          deletedChallenges: deletedChallenges.length,
        },
        "Purged expired 7-day challenge records"
      );
    }
  } catch (err) {
    logger.error(
      { event: "retention_cleanup_error", err },
      "7-day retention cleanup error"
    );
  }
}

let isSchedulerTickRunning = false;

async function runScheduledClubsTick(): Promise<void> {
  if (isSchedulerTickRunning) {
    return;
  }
  isSchedulerTickRunning = true;
  try {
    await purgeExpiredSevenDayRecords();
    if (!env.TELEGRAM_BOT_TOKEN) return;
    await reconcileConnectedClubsAdminsPeriodically();
    const activeClubs = await db
      .select()
      .from(clubs)
      .where(and(eq(clubs.status, "active"), eq(clubs.isActive, true)));

    const now = new Date();
    for (const club of activeClubs) {
      if (!club.lastPublishedAt && club.topicThreadId > 0) {
        try {
          await publishChallengeToClub(club.chatId);
        } catch (err) {
          logger.error(
            { event: "initial_publish_error", chatId: club.chatId, err },
            "Initial challenge recovery failed for club"
          );
        }
        continue;
      }

      const schedule = normalizeWeeklySchedule(club.weeklySchedule);
      const zoned = getClubZonedTime(now, club.timezone);
      const dayConfig = schedule[zoned.day];
      if (!dayConfig.enabled || dayConfig.slots.length === 0) {
        continue;
      }

      const matchingSlot = dayConfig.slots.find((slot) => {
        if (zoned.hour < slot.from_hour || zoned.hour >= slot.to_hour) {
          return false;
        }
        const minutesSinceStart =
          (zoned.hour - slot.from_hour) * 60 + zoned.minute;
        const remainder = minutesSinceStart % slot.interval_minutes;
        // Allow a 5-minute grace window (0..5 min after the scheduled mark) so transient errors or restarts still publish
        return remainder >= 0 && remainder <= 5;
      });

      if (!matchingSlot) continue;

      if (club.lastPublishedAt) {
        const elapsedMs =
          now.getTime() - new Date(club.lastPublishedAt).getTime();
        const minCooldownMs =
          Math.max(8, matchingSlot.interval_minutes - 6) * 60 * 1000;
        if (elapsedMs < minCooldownMs) {
          continue;
        }
      }

      const unresolved = await findLatestUnresolvedChallenge(club.chatId);
      if (unresolved) {
        if (
          !club.autoPaused &&
          club.autoPauseChallengeId !== unresolved.id
        ) {
          if (club.autoPauseMessageId) {
            await deleteTelegramMessage(club.chatId, club.autoPauseMessageId);
          }

          await db
            .update(clubs)
            .set({
              autoPaused: true,
              autoPauseChallengeId: unresolved.id,
              autoPauseMessageId: null,
              updatedAt: new Date(),
            })
            .where(eq(clubs.chatId, club.chatId));

          try {
            const pauseMessageId = await notifyAutoPauseReplyOnce(
              club,
              unresolved
            );
            logger.info(
              {
                event: "club_auto_paused",
                chatId: club.chatId,
                challengeId: unresolved.id,
              },
              "Club entered auto-pause due to unresolved challenge"
            );
            if (pauseMessageId) {
              await db
                .update(clubs)
                .set({
                  autoPauseMessageId: pauseMessageId,
                  updatedAt: new Date(),
                })
                .where(eq(clubs.chatId, club.chatId));
            }
          } catch (err) {
            logger.error(
              { event: "auto_pause_notify_error", chatId: club.chatId, err },
              "Auto-pause notification failed for club"
            );
          }
        }
        continue;
      }

      if (club.autoPaused || club.autoPauseMessageId !== null) {
        await clearAutoPause(club.chatId);
      }

      try {
        await publishChallengeToClub(club.chatId, {
          discipline: matchingSlot.discipline,
          difficulty: matchingSlot.difficulty,
          focusGroup: matchingSlot.focus_group,
          focusKey: matchingSlot.focus_key,
          objective: matchingSlot.objective,
        });
      } catch (err) {
        logger.error(
          { event: "scheduled_publish_error", chatId: club.chatId, err },
          "Scheduled publish failed for club"
        );
      }
    }
  } catch (err) {
    logger.error({ event: "scheduler_tick_error", err }, "Scheduler tick error");
  } finally {
    isSchedulerTickRunning = false;
  }
}

export function startTelegramBotBackgroundLoops(): void {
  if (!env.TELEGRAM_BOT_TOKEN || pollingActive) return;
  pollingActive = true;

  const loop = async () => {
    while (pollingActive) {
      const nextDelayMs = await pollTelegramUpdatesOnce();
      await new Promise((r) => setTimeout(r, nextDelayMs));
    }
  };
  void loop();

  setTimeout(() => {
    void runScheduledClubsTick();
  }, 3_000);

  setInterval(() => {
    void runScheduledClubsTick();
  }, 60_000);
}
