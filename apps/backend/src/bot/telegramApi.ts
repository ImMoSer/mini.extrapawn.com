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
  parameters?: {
    retry_after?: number;
  };
}

export interface CallTelegramJsonOptions {
  timeoutMs?: number;
  maxAttempts?: number;
}

/**
 * Returns `true` when Telegram's Bot API responded with a transient server/rate-limit
 * status (`429`, `500`, `502`, `503`, `504`) rather than an authoritative domain rejection
 * (such as `400 Bad Request` or `403 Forbidden`).
 */
export function isTransientTelegramApiError(
  res: Pick<TelegramApiResponse<unknown>, "ok" | "error_code">
): boolean {
  if (res.ok) return false;
  const code = res.error_code;
  return (
    code === 429 ||
    code === 500 ||
    code === 502 ||
    code === 503 ||
    code === 504
  );
}

export interface SendTelegramPhotoParams {
  chatId: string;
  messageThreadId?: number;
  pngBuffer: Buffer;
  caption: string;
  replyMarkup?: Record<string, unknown>;
}

export interface SendTelegramPhotoOutcome {
  messageId: number | null;
  deliveryUncertain: boolean;
  apiErrorDescription?: string;
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

/**
 * Returns `true` ONLY when a network failure occurred BEFORE the HTTP request body
 * could reach Telegram's servers (DNS lookup or TCP/TLS connect failure).
 * Post-upload timeouts (`TimeoutError`/`AbortError`) or mid-flight socket resets (`ECONNRESET`)
 * return `false` so non-idempotent `sendPhoto` uploads are never blindly duplicated.
 */
function isSafePreConnectError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return false;
  }
  const cause = (error as Error & { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return false;
  const code = (cause as { code?: string }).code;
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "UND_ERR_CONNECT_TIMEOUT"
  );
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
  payload: Record<string, unknown>,
  options?: CallTelegramJsonOptions
): Promise<TelegramApiResponse<T>> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, description: "TELEGRAM_BOT_TOKEN not set" };
  }
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const isLongPoll = method === "getUpdates";
  const maxAttempts = options?.maxAttempts ?? (isLongPoll ? 1 : 3);
  const timeoutMs = options?.timeoutMs ?? (isLongPoll ? 25_000 : 15_000);

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

/**
 * Uploads a PNG photo to Telegram with strict idempotency safety:
 * - Waits up to `60s` so slow Telegram DC responses still return `message_id`.
 * - Retries (`maxAttempts = 2`) ONLY when the upload was provably NOT accepted
 *   (`502`/`503`/`429` or pre-body TCP/DNS connect failure).
 * - Never retries post-upload timeouts (`TimeoutError`/`504`/`ECONNRESET`), returning
 *   `deliveryUncertain: true` so the caller will not post ghost duplicates.
 */
export async function sendTelegramPhotoWithOutcome(
  params: SendTelegramPhotoParams
): Promise<SendTelegramPhotoOutcome> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { messageId: null, deliveryUncertain: false };
  }

  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const form = new FormData();
      form.append("chat_id", params.chatId);
      if (params.messageThreadId && params.messageThreadId > 0) {
        form.append("message_thread_id", String(params.messageThreadId));
      }
      form.append("parse_mode", "HTML");
      form.append("caption", params.caption);
      if (params.replyMarkup) {
        form.append("reply_markup", JSON.stringify(params.replyMarkup));
      }
      const blob = new Blob([new Uint8Array(params.pngBuffer)], {
        type: "image/png",
      });
      form.append("photo", blob, "board.png");

      const res = await fetch(url, {
        method: "POST",
        headers: { Connection: "close" },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });

      const rawText = await res.text();
      let data: TelegramApiResponse<{ message_id: number }> | null = null;
      try {
        data = JSON.parse(rawText) as TelegramApiResponse<{
          message_id: number;
        }>;
      } catch {
        data = null;
      }

      if (data?.ok) {
        return {
          messageId: data.result?.message_id ?? null,
          deliveryUncertain: false,
        };
      }

      const statusCode = data?.error_code ?? res.status;
      const description = data?.description ?? `Telegram HTTP ${res.status}`;

      // 504 Gateway Timeout means Telegram's upstream may still finish delivering the photo
      if (statusCode === 504) {
        console.warn(
          `[TelegramBot] sendPhoto HTTP 504 for chat ${params.chatId} (thread ${params.messageThreadId ?? 0}); not retrying to prevent duplicate post.`
        );
        return {
          messageId: null,
          deliveryUncertain: true,
          apiErrorDescription: description,
        };
      }

      const isSafeRetryStatus =
        statusCode === 502 ||
        statusCode === 503 ||
        (statusCode === 429 && (data?.parameters?.retry_after ?? 99) <= 10);

      if (isSafeRetryStatus && attempt < maxAttempts) {
        const delayMs =
          statusCode === 429
            ? (data?.parameters?.retry_after ?? 2) * 1000
            : 2_500;
        console.warn(
          `[TelegramBot] sendPhoto HTTP ${statusCode} (${description}) for chat ${params.chatId}, retrying once in ${delayMs}ms...`
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      console.error(
        `[TelegramBot] sendPhoto API error for chat ${params.chatId} (thread ${params.messageThreadId ?? 0}): ${description}`
      );
      return {
        messageId: null,
        deliveryUncertain: false,
        apiErrorDescription: description,
      };
    } catch (err) {
      if (isSafePreConnectError(err) && attempt < maxAttempts) {
        console.warn(
          `[TelegramBot] sendPhoto pre-connect error for chat ${params.chatId}, retrying once in 2s: ${describeNetworkError(err)}`
        );
        await new Promise((r) => setTimeout(r, 2_000));
        continue;
      }

      const uncertain = !isSafePreConnectError(err);
      console.warn(
        `[TelegramBot] sendPhoto ${uncertain ? "post-upload timeout/socket reset (no retry to prevent duplicate)" : "connect failure"} for chat ${params.chatId}: ${describeNetworkError(err)}`
      );
      return {
        messageId: null,
        deliveryUncertain: uncertain,
        apiErrorDescription: describeNetworkError(err),
      };
    }
  }

  return { messageId: null, deliveryUncertain: false };
}

export async function sendTelegramPhoto(
  params: SendTelegramPhotoParams
): Promise<number | null> {
  const outcome = await sendTelegramPhotoWithOutcome(params);
  return outcome.messageId;
}
