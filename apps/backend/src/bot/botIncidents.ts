import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";
import type { TelegramUserPayload } from "./botTypes.js";
import {
  callTelegramJson,
  escapeHtml,
  normalizeLang,
  sendTelegramPhoto,
} from "./telegramApi.js";

// Deduplicates identical SuperAdmin incident DMs within 60 seconds
const recentSuperadminAlerts = new Map<string, number>();

// Tracks intentional bot leaves (validation failure, SuperAdmin block/purge) so we don't send false incident DMs
const botInitiatedLeaves = new Map<string, number>();

export function markBotInitiatedLeave(chatId: string): void {
  botInitiatedLeaves.set(chatId, Date.now() + 30_000);
}

export function consumeBotInitiatedLeave(chatId: string): boolean {
  const expiresAt = botInitiatedLeaves.get(chatId);
  if (!expiresAt) return false;
  botInitiatedLeaves.delete(chatId);
  return Date.now() <= expiresAt;
}

export async function notifySuperadminBotIncident(params: {
  kind: "bot_removed" | "rights_revoked";
  chatId: string;
  clubTitle: string;
  clubUsername?: string | null;
  detail: string;
  actor?: TelegramUserPayload;
}): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.SUPERADMIN_TELEGRAM_ID) return;

  const dedupKey = `${params.chatId}:${params.kind}:${params.detail}`;
  const nowMs = Date.now();
  const prevAt = recentSuperadminAlerts.get(dedupKey);
  if (prevAt && nowMs - prevAt < 60_000) {
    return;
  }
  recentSuperadminAlerts.set(dedupKey, nowMs);

  const safeTitle = escapeHtml(params.clubTitle || `Club ${params.chatId}`);
  const clubHandle = params.clubUsername
    ? ` (@${escapeHtml(params.clubUsername)})`
    : "";
  const safeDetail = escapeHtml(params.detail);

  let actorLine = "";
  if (params.actor) {
    const actorName = escapeHtml(
      [params.actor.first_name, params.actor.last_name]
        .filter(Boolean)
        .join(" ")
        .trim() || "User"
    );
    const actorHandle = params.actor.username
      ? `@${escapeHtml(params.actor.username)}, `
      : "";
    actorLine = `\n👤 <b>Кто выполнил:</b> ${actorName} (${actorHandle}ID: <code>${params.actor.id}</code>)`;
  }

  const header =
    params.kind === "bot_removed"
      ? `🚨 <b>Бота удалили / кикнули из клуба!</b>`
      : `⚠️ <b>Бота лишили прав в клубе!</b>`;

  const statusNote =
    params.kind === "bot_removed"
      ? `⏸ Клуб переведён в статус <b>BOT REMOVED</b> (публикации остановлены, данные сохранены в БД). Вы можете полностью удалить данные клуба или заблокировать его в панели BOSS.`
      : `⏸ Клуб автоматически поставлен на паузу (<b>PAUSED</b>), данные сохранены в БД. Вы можете связаться с клубом, заблокировать его или полностью удалить данные в панели BOSS.`;

  const text = [
    header,
    ``,
    `🏛 <b>Клуб:</b> ${safeTitle}${clubHandle}`,
    `🆔 <b>chat_id:</b> <code>${escapeHtml(params.chatId)}</code>`,
    `📌 <b>Детали:</b> ${safeDetail}${actorLine}`,
    ``,
    statusNote,
  ].join("\n");

  try {
    await callTelegramJson("sendMessage", {
      chat_id: env.SUPERADMIN_TELEGRAM_ID,
      parse_mode: "HTML",
      text,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🛡 Открыть панель BOSS",
              url: `https://t.me/${env.BOT_USERNAME}?startapp=superadmin`,
            },
          ],
        ],
      },
    });
  } catch (err) {
    console.warn(
      "[TelegramBot] Failed to send incident DM to SuperAdmin:",
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Forces the bot to leave a chat (used when SuperAdmin blocks a club or when onboarding validation fails).
 */
export async function leaveClubChat(
  chatId: string,
  reasonMessage?: string
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  markBotInitiatedLeave(chatId);
  if (reasonMessage) {
    await callTelegramJson("sendMessage", {
      chat_id: chatId,
      text: reasonMessage,
    });
  }
  await callTelegramJson("leaveChat", { chat_id: chatId });
}

/**
 * Sends the localized blocked-club notice with the @ProfessorMozer QR code and link, then leaves the chat.
 */
export async function sendBlockedClubNoticeAndLeave(
  chatId: string,
  topicThreadId?: number,
  rawLang?: string | null
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;

  const lang = normalizeLang(rawLang);
  const caption =
    lang === "en"
      ? `⛔ <b>Your club is temporarily blocked.</b>\nPlease contact the developer: <a href="https://t.me/ProfessorMozer">@ProfessorMozer</a>`
      : lang === "de"
        ? `⛔ <b>Ihr Klub ist vorübergehend gesperrt.</b>\nBitte wenden Sie sich an den Entwickler: <a href="https://t.me/ProfessorMozer">@ProfessorMozer</a>`
        : `⛔ <b>Ваш клуб временно заблокирован.</b>\nОбратитесь к разработчику: <a href="https://t.me/ProfessorMozer">@ProfessorMozer</a>`;

  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: "💬 @ProfessorMozer",
          url: "https://t.me/ProfessorMozer",
        },
      ],
    ],
  };

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const qrAssetPath = path.resolve(
    currentDir,
    "../../assets/professor_mozer_qr.png"
  );
  let sentPhotoId: number | null = null;

  if (fs.existsSync(qrAssetPath)) {
    const qrBuffer = fs.readFileSync(qrAssetPath);
    if (topicThreadId && topicThreadId > 0) {
      sentPhotoId = await sendTelegramPhoto({
        chatId,
        messageThreadId: topicThreadId,
        pngBuffer: qrBuffer,
        caption,
        replyMarkup,
      });
    }
    if (!sentPhotoId) {
      sentPhotoId = await sendTelegramPhoto({
        chatId,
        pngBuffer: qrBuffer,
        caption,
        replyMarkup,
      });
    }
  }

  if (!sentPhotoId) {
    const msgPayload: Record<string, unknown> = {
      chat_id: chatId,
      parse_mode: "HTML",
      text: caption,
      reply_markup: replyMarkup,
    };
    if (topicThreadId && topicThreadId > 0) {
      msgPayload.message_thread_id = topicThreadId;
    }
    const msgRes = await callTelegramJson("sendMessage", msgPayload);
    if (!msgRes.ok && topicThreadId && topicThreadId > 0) {
      delete msgPayload.message_thread_id;
      await callTelegramJson("sendMessage", msgPayload);
    }
  }

  markBotInitiatedLeave(chatId);
  await callTelegramJson("leaveChat", { chat_id: chatId });
}
