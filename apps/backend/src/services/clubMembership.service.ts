import { and, eq } from "drizzle-orm";
import type { AppLanguage } from "shared";
import {
  callTelegramJson,
  describeNetworkError,
  isTransientTelegramApiError,
} from "../bot/telegramApi.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { db } from "../db/index.js";
import { challengeAttempts, clubAdmins } from "../db/schema.js";

interface TelegramMemberLookupPayload {
  status: string;
  is_member?: boolean;
}

const POSITIVE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes for verified members
const NEGATIVE_CACHE_TTL_MS = 30 * 1000; // 30 seconds so newly-joined members pass right away
const FALLBACK_POSITIVE_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes for DB-affiliated fallback during Telegram API outage
const TELEGRAM_MEMBERSHIP_TIMEOUT_MS = 4_000; // Fast timeout for interactive HTTP request paths
const MAX_CACHE_ENTRIES = 5_000;

const membershipCache = new Map<
  string,
  { isMember: boolean; expiresAt: number }
>();

const inFlightMembershipChecks = new Map<string, Promise<boolean>>();

const MEMBERSHIP_ERRORS: Record<AppLanguage, string> = {
  ru: "Чтобы участвовать в челленджах этого клуба, необходимо состоять в его Telegram-группе.",
  en: "You must be a member of this club's Telegram supergroup to participate in its challenges.",
  de: "Sie müssen Mitglied der Telegram-Supergruppe dieses Klubs sein, um an dessen Challenges teilzunehmen.",
};

export class ClubMembershipRequiredError extends Error {
  public readonly statusCode = 403;

  constructor(lang: AppLanguage) {
    super(MEMBERSHIP_ERRORS[lang] ?? MEMBERSHIP_ERRORS.ru);
    this.name = "ClubMembershipRequiredError";
  }
}

function setMembershipCache(
  key: string,
  isMember: boolean,
  ttlMs: number
): void {
  if (!membershipCache.has(key) && membershipCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = membershipCache.keys().next().value;
    if (oldestKey !== undefined) {
      membershipCache.delete(oldestKey);
    }
  }
  membershipCache.set(key, {
    isMember,
    expiresAt: Date.now() + ttlMs,
  });
}

export function invalidateClubMembershipCache(
  chatId: string,
  telegramId?: string
): void {
  if (telegramId) {
    membershipCache.delete(`${chatId}:${telegramId}`);
    return;
  }
  const prefix = `${chatId}:`;
  for (const key of membershipCache.keys()) {
    if (key.startsWith(prefix)) {
      membershipCache.delete(key);
    }
  }
}

function isActiveTelegramGroupMember(
  payload: TelegramMemberLookupPayload | undefined
): boolean {
  if (!payload) return false;
  if (
    payload.status === "creator" ||
    payload.status === "administrator" ||
    payload.status === "member"
  ) {
    return true;
  }
  if (payload.status === "restricted") {
    return payload.is_member !== false;
  }
  return false;
}

async function hasHistoricalClubAffiliation(
  chatId: string,
  telegramId: string
): Promise<boolean> {
  const [adminRow] = await db
    .select({ telegramId: clubAdmins.telegramId })
    .from(clubAdmins)
    .where(
      and(
        eq(clubAdmins.chatId, chatId),
        eq(clubAdmins.telegramId, telegramId)
      )
    )
    .limit(1);
  if (adminRow) return true;

  const [solvedRow] = await db
    .select({ id: challengeAttempts.id })
    .from(challengeAttempts)
    .where(
      and(
        eq(challengeAttempts.chatId, chatId),
        eq(challengeAttempts.telegramId, telegramId),
        eq(challengeAttempts.solved, true)
      )
    )
    .limit(1);
  return Boolean(solvedRow);
}

async function verifyClubMembershipUncached(
  chatId: string,
  telegramId: string,
  numericUserId: number,
  cacheKey: string
): Promise<boolean> {
  try {
    const res = await callTelegramJson<TelegramMemberLookupPayload>(
      "getChatMember",
      {
        chat_id: chatId,
        user_id: numericUserId,
      },
      {
        timeoutMs: TELEGRAM_MEMBERSHIP_TIMEOUT_MS,
        maxAttempts: 1,
      }
    );

    if (isTransientTelegramApiError(res)) {
      throw new Error(
        res.description ?? `Telegram transient HTTP ${res.error_code ?? "5xx"}`
      );
    }

    const isMember = res.ok && isActiveTelegramGroupMember(res.result);
    setMembershipCache(
      cacheKey,
      isMember,
      isMember ? POSITIVE_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS
    );
    return isMember;
  } catch (err) {
    logger.warn(
      {
        event: "club_membership_transient_warn",
        chatId,
        telegramId,
        error: describeNetworkError(err),
      },
      "getChatMember transient error; using historical DB fallback"
    );
    // Transient outage on api.telegram.org: allow already-known club participants
    // and cache the positive fallback briefly so subsequent moves don't stall on a dead gateway.
    const known = await hasHistoricalClubAffiliation(chatId, telegramId);
    if (known) {
      setMembershipCache(cacheKey, true, FALLBACK_POSITIVE_CACHE_TTL_MS);
    }
    return known;
  }
}

/**
 * Verifies via Telegram Bot API (`getChatMember`) that `telegramId` is an actual member
 * of the supergroup `chatId` before accepting challenge submissions or triggering chat replies.
 */
export async function requireClubParticipantMembership(params: {
  chatId: string;
  telegramId: string;
  isSuperadmin: boolean;
  languageCode: AppLanguage;
}): Promise<void> {
  if (params.isSuperadmin || !env.TELEGRAM_BOT_TOKEN) {
    return;
  }

  const cacheKey = `${params.chatId}:${params.telegramId}`;
  const cached = membershipCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.isMember) {
      throw new ClubMembershipRequiredError(params.languageCode);
    }
    return;
  }

  const numericUserId = Number(params.telegramId);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    throw new ClubMembershipRequiredError(params.languageCode);
  }

  let checkPromise = inFlightMembershipChecks.get(cacheKey);
  if (!checkPromise) {
    checkPromise = verifyClubMembershipUncached(
      params.chatId,
      params.telegramId,
      numericUserId,
      cacheKey
    ).finally(() => {
      inFlightMembershipChecks.delete(cacheKey);
    });
    inFlightMembershipChecks.set(cacheKey, checkPromise);
  }

  const isMember = await checkPromise;
  if (!isMember) {
    throw new ClubMembershipRequiredError(params.languageCode);
  }
}

export async function isClubParticipantMember(params: {
  chatId: string;
  telegramId: string;
  isSuperadmin: boolean;
}): Promise<boolean> {
  try {
    await requireClubParticipantMembership({
      ...params,
      languageCode: "ru",
    });
    return true;
  } catch {
    return false;
  }
}
