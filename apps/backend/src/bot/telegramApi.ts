import { normalizeAutoDeleteSeconds, type AppLanguage } from "shared";
import { env } from "../config/env.js";

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
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
      return (await res.json()) as TelegramApiResponse<T>;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        console.warn(
          `[TelegramBot] ${method} network error (attempt ${attempt}/${maxAttempts}), retrying...`,
          err instanceof Error ? err.message : err
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
      `[TelegramBot] deleteMessage failed for chat ${chatId} (message ${messageId}):`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Schedules automatic deletion of a club topic notification after `rawSeconds`
 * (`30 | 60 | 180 | 300`). When `0` ("Off" / "Нет"), the message is kept permanently.
 */
export function scheduleAutoDeleteMessage(
  chatId: string,
  messageId: number | undefined | null,
  rawSeconds: unknown
): void {
  if (!messageId) return;
  const seconds = normalizeAutoDeleteSeconds(rawSeconds);
  if (seconds <= 0) return;

  setTimeout(() => {
    void deleteTelegramMessage(chatId, messageId);
  }, seconds * 1000);
}
