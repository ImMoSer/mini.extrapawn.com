import { eq } from "drizzle-orm";
import type { AppLanguage } from "shared";
import { env } from "../config/env.js";
import { db, sqlClient } from "../db/index.js";
import { clubs } from "../db/schema.js";

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

/**
 * Unwraps Node/Undici `TypeError: fetch failed` causes so socket-level codes
 * (`ECONNRESET`, `ETIMEDOUT`, `UND_ERR_SOCKET`, `UND_ERR_CONNECT_TIMEOUT`) appear in logs.
 */
export function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const base = error.message || error.name;
  const cause = (error as Error & { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") {
    return base;
  }
  const c = cause as {
    code?: string;
    syscall?: string;
    message?: string;
  };
  const parts: string[] = [];
  if (c.code) parts.push(c.code);
  if (c.syscall) parts.push(`syscall=${c.syscall}`);
  if (c.message && c.message !== base) parts.push(c.message);
  return parts.length > 0 ? `${base} [${parts.join(", ")}]` : base;
}

export function normalizeLang(raw: string | null | undefined): AppLanguage {
  if (raw === "en" || raw === "de") return raw;
  return "ru";
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function callTelegramJson<T>(
  method: string,
  payload: Record<string, unknown>
): Promise<TelegramApiResponse<T>> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, description: "TELEGRAM_BOT_TOKEN not set" };
  }
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const isLongPoll = method === "getUpdates";
  const maxAttempts = isLongPoll ? 1 : 3;
  const timeoutMs = isLongPoll ? 25_000 : 15_000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Connection: "close",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const rawText = await res.text();
      try {
        return JSON.parse(rawText) as TelegramApiResponse<T>;
      } catch {
        if (
          (res.status === 500 ||
            res.status === 502 ||
            res.status === 503 ||
            res.status === 504) &&
          attempt < maxAttempts
        ) {
          await new Promise((r) => setTimeout(r, 400 * attempt));
          continue;
        }
        return {
          ok: false,
          error_code: res.status,
          description: `Telegram HTTP ${res.status}`,
        };
      }
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        console.warn(
          `[TelegramBot] ${method} network error (attempt ${attempt}/${maxAttempts}), retrying: ${describeNetworkError(err)}`
        );
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }
  throw lastError;
}

export async function deleteTelegramMessage(
  chatId: string,
  messageId: number
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !messageId) return;
  try {
    await callTelegramJson("deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  } catch (err) {
    console.warn(
      `[TelegramBot] deleteMessage failed for chat ${chatId} (message ${messageId}): ${describeNetworkError(err)}`
    );
  }
}

/**
 * Deletes up to N messages in batches of 100 via Telegram's `deleteMessages`.
 * Falls back to individual `deleteMessage` calls if a batch contains >48h-old IDs.
 */
export async function deleteTelegramMessagesBatch(
  chatId: string,
  messageIds: readonly number[]
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const uniqueIds = Array.from(
    new Set(messageIds.filter((id) => Number.isInteger(id) && id > 0))
  );
  if (uniqueIds.length === 0) return;

  for (let i = 0; i < uniqueIds.length; i += 100) {
    const chunk = uniqueIds.slice(i, i + 100);
    if (chunk.length === 1 && chunk[0]) {
      await deleteTelegramMessage(chatId, chunk[0]);
      continue;
    }
    try {
      const res = await callTelegramJson<boolean>("deleteMessages", {
        chat_id: chatId,
        message_ids: chunk,
      });
      if (!res.ok) {
        for (const id of chunk) {
          await deleteTelegramMessage(chatId, id);
        }
      }
    } catch {
      for (const id of chunk) {
        await deleteTelegramMessage(chatId, id);
      }
    }
  }
}

/**
 * Atomically records a transient bot message ID (`notifyChallengeSolved`, `notifyClubSettingsUpdated`)
 * in `tele_app.clubs.topic_message_ids` so it is deleted when the next challenge is published.
 */
export async function appendClubTopicMessageId(
  chatId: string,
  messageId: number | undefined | null
): Promise<void> {
  if (!messageId || messageId <= 0) return;
  await sqlClient`
    UPDATE tele_app.clubs
    SET topic_message_ids = array_append(topic_message_ids, ${messageId})
    WHERE chat_id = ${chatId}
  `;
}

/**
 * Deletes all transient topic messages (`topic_message_ids` + previous challenge board IDs)
 * posted prior to `newChallengeMessageId`, preserving any concurrent message posted after it.
 */
export async function flushClubTopicMessagesOnPublish(
  chatId: string,
  newChallengeMessageId: number | null,
  extraMessageIds: readonly number[]
): Promise<void> {
  const [clubRow] = await db
    .select({
      topicMessageIds: clubs.topicMessageIds,
      autoPauseMessageId: clubs.autoPauseMessageId,
    })
    .from(clubs)
    .where(eq(clubs.chatId, chatId))
    .limit(1);

  const storedIds = clubRow?.topicMessageIds ?? [];
  const pauseId = clubRow?.autoPauseMessageId
    ? [clubRow.autoPauseMessageId]
    : [];
  const allCandidates = [...storedIds, ...pauseId, ...extraMessageIds];

  const idsToDelete = allCandidates.filter((id) => {
    if (!Number.isInteger(id) || id <= 0) return false;
    if (newChallengeMessageId && id >= newChallengeMessageId) return false;
    return true;
  });

  await deleteTelegramMessagesBatch(chatId, idsToDelete);

  if (newChallengeMessageId && newChallengeMessageId > 0) {
    await sqlClient`
      UPDATE tele_app.clubs
      SET topic_message_ids = COALESCE(
        (SELECT array_agg(x) FROM unnest(topic_message_ids) AS x WHERE x >= ${newChallengeMessageId}),
        '{}'::integer[]
      )
      WHERE chat_id = ${chatId}
    `;
  } else {
    await db
      .update(clubs)
      .set({ topicMessageIds: [] })
      .where(eq(clubs.chatId, chatId));
  }
}
