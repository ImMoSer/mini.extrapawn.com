import { and, desc, eq, gte, inArray } from "drizzle-orm";
import {
  calculateAttemptPoints,
  isSameDayInTimezone,
  roundPoints,
  type ChallengeAttemptStatus,
  type ChallengeDifficulty,
  type ChallengeDiscipline,
  type ClubChallengeItemDTO,
  type ClubRecordEntryDTO,
  type ClubRecordsResponseDTO,
  type GoActiveChallengeItemDTO,
  type NextActiveChallengeRefDTO,
} from "shared";
import { db } from "../db/index.js";
import {
  challengeAttempts,
  clubAdmins,
  clubChallenges,
  clubs,
  users,
} from "../db/schema.js";
import { mapClubRowToSummaryDTO } from "./clubMapper.js";

export class ClubNotFoundError extends Error {
  public readonly statusCode = 404;

  constructor(chatId: string) {
    super(`Club '${chatId}' is not registered or unavailable.`);
    this.name = "ClubNotFoundError";
  }
}

export async function requireExistingClub(
  chatId: string,
  options?: { allowSuperadminBypass?: boolean }
) {
  const [existing] = await db
    .select()
    .from(clubs)
    .where(eq(clubs.chatId, chatId))
    .limit(1);

  if (!existing) {
    throw new ClubNotFoundError(chatId);
  }

  if (
    !options?.allowSuperadminBypass &&
    (existing.status === "blocked" ||
      existing.status === "bot_removed" ||
      existing.status === "pending")
  ) {
    throw new ClubNotFoundError(chatId);
  }

  return existing;
}

export async function isChallengeExpiredForViewer(params: {
  chatId: string;
  discipline: ChallengeDiscipline;
  puzzleId: string;
  edition: string;
  viewerTelegramId: string;
  clubTimezone: string;
}): Promise<boolean> {
  const [challengeRow] = await db
    .select({ publishedAt: clubChallenges.publishedAt })
    .from(clubChallenges)
    .where(
      and(
        eq(clubChallenges.chatId, params.chatId),
        eq(clubChallenges.discipline, params.discipline),
        eq(clubChallenges.puzzleId, params.puzzleId),
        eq(clubChallenges.edition, params.edition)
      )
    )
    .limit(1);

  if (!challengeRow) {
    return false;
  }

  if (
    isSameDayInTimezone(
      challengeRow.publishedAt,
      new Date(),
      params.clubTimezone
    )
  ) {
    return false;
  }

  const [viewerAttempt] = await db
    .select({ status: challengeAttempts.status })
    .from(challengeAttempts)
    .where(
      and(
        eq(challengeAttempts.chatId, params.chatId),
        eq(challengeAttempts.discipline, params.discipline),
        eq(challengeAttempts.puzzleId, params.puzzleId),
        eq(challengeAttempts.edition, params.edition),
        eq(challengeAttempts.telegramId, params.viewerTelegramId)
      )
    )
    .limit(1);

  return (
    viewerAttempt?.status !== "solved" &&
    viewerAttempt?.status !== "surrendered"
  );
}

/**
 * Single source of truth for today's unsolved challenges across all clubs
 * the viewer participates in (used by both /challenges/go-feed and Next Challenge CTA).
 */
export async function getViewerTodayActiveChallenges(params: {
  viewerTelegramId: string;
  isSuperadmin: boolean;
}): Promise<GoActiveChallengeItemDTO[]> {
  const [allClubs, myAdminRows, myParticipatedRows] = await Promise.all([
    db.select().from(clubs),
    db
      .select({ chatId: clubAdmins.chatId })
      .from(clubAdmins)
      .where(eq(clubAdmins.telegramId, params.viewerTelegramId)),
    db
      .select({ chatId: challengeAttempts.chatId })
      .from(challengeAttempts)
      .where(eq(challengeAttempts.telegramId, params.viewerTelegramId)),
  ]);

  const adminChatIds = new Set(myAdminRows.map((r) => r.chatId));
  const participatedChatIds = new Set(
    myParticipatedRows.map((r) => r.chatId)
  );

  const memberClubs = allClubs.filter(
    (c) =>
      c.status !== "blocked" &&
      c.status !== "bot_removed" &&
      c.status !== "pending" &&
      (params.isSuperadmin ||
        adminChatIds.has(c.chatId) ||
        participatedChatIds.has(c.chatId))
  );

  if (memberClubs.length === 0) {
    return [];
  }

  const clubByChatId = new Map(memberClubs.map((c) => [c.chatId, c]));
  const memberChatIds = memberClubs.map((c) => c.chatId);

  const [recentChallenges, attemptRows] = await Promise.all([
    db
      .select()
      .from(clubChallenges)
      .where(inArray(clubChallenges.chatId, memberChatIds))
      .orderBy(desc(clubChallenges.publishedAt))
      .limit(100),
    db
      .select()
      .from(challengeAttempts)
      .where(inArray(challengeAttempts.chatId, memberChatIds)),
  ]);

  interface GoStatsBucket {
    solvedCount: number;
    bestTimeMs: number | null;
    myStatus: ChallengeAttemptStatus | null;
    mySolved: boolean;
    myPoints: number;
    myAttempts: number;
  }

  const statsByKey = new Map<string, GoStatsBucket>();
  for (const att of attemptRows) {
    const key = `${att.chatId}:${att.discipline}:${att.puzzleId}:${att.edition}`;
    let bucket = statsByKey.get(key);
    if (!bucket) {
      bucket = {
        solvedCount: 0,
        bestTimeMs: null,
        myStatus: null,
        mySolved: false,
        myPoints: 0,
        myAttempts: 0,
      };
      statsByKey.set(key, bucket);
    }

    if (att.solved) {
      bucket.solvedCount += 1;
      if (att.solvedTimeMs !== null && att.solvedTimeMs !== undefined) {
        const ms = Number(att.solvedTimeMs);
        if (bucket.bestTimeMs === null || ms < bucket.bestTimeMs) {
          bucket.bestTimeMs = ms;
        }
      }
    }

    if (att.telegramId === params.viewerTelegramId) {
      bucket.myStatus = (att.status || "in_progress") as ChallengeAttemptStatus;
      bucket.mySolved = att.solved;
      bucket.myPoints = roundPoints(
        calculateAttemptPoints(att.solved, att.attempts)
      );
      bucket.myAttempts = att.attempts;
    }
  }

  const now = new Date();
  const activeItems: GoActiveChallengeItemDTO[] = [];

  for (const c of recentChallenges) {
    const club = clubByChatId.get(c.chatId);
    if (!club || !isSameDayInTimezone(c.publishedAt, now, club.timezone)) {
      continue;
    }

    const key = `${c.chatId}:${c.discipline}:${c.puzzleId}:${c.edition}`;
    const b = statsByKey.get(key);
    const myStatus = b?.myStatus ?? null;
    if (myStatus === "solved" || myStatus === "surrendered") {
      continue;
    }

    activeItems.push({
      chat_id: c.chatId,
      club_title: club.title || `Club ${c.chatId}`,
      discipline: c.discipline as ChallengeDiscipline,
      puzzle_id: c.puzzleId,
      edition: c.edition,
      difficulty: c.difficulty as ChallengeDifficulty,
      category: c.category || c.domain || "MIX",
      domain: c.domain || "",
      published_at: c.publishedAt.toISOString(),
      solved_count: b?.solvedCount ?? 0,
      best_time_ms: b?.bestTimeMs ?? null,
      my_status: myStatus,
      my_solved: b?.mySolved ?? false,
      my_points: b?.myPoints ?? 0,
      my_attempts: b?.myAttempts ?? 0,
    });
  }

  return activeItems;
}

export async function computeViewerNextActive(params: {
  chatId: string;
  viewerTelegramId: string;
  viewerIsSuperadmin: boolean;
  exclude?: {
    discipline: string;
    puzzleId: string;
    edition: string;
  };
}): Promise<{
  remainingActiveCount: number;
  nextActiveChallenge: NextActiveChallengeRefDTO | null;
}> {
  const goItems = await getViewerTodayActiveChallenges({
    viewerTelegramId: params.viewerTelegramId,
    isSuperadmin: params.viewerIsSuperadmin,
  });

  const remaining = goItems.filter((item) => {
    if (
      params.exclude &&
      item.chat_id === params.chatId &&
      item.discipline === params.exclude.discipline &&
      item.puzzle_id === params.exclude.puzzleId &&
      item.edition === params.exclude.edition
    ) {
      return false;
    }
    return true;
  });

  const next =
    remaining.find((item) => item.chat_id === params.chatId) ??
    remaining[0] ??
    null;

  return {
    remainingActiveCount: remaining.length,
    nextActiveChallenge: next
      ? {
          discipline: next.discipline,
          puzzle_id: next.puzzle_id,
          edition: next.edition,
          chat_id: next.chat_id,
        }
      : null,
  };
}

export async function buildClubRecordsResponse(params: {
  chatId: string;
  viewerTelegramId: string;
  viewerIsSuperadmin: boolean;
}): Promise<ClubRecordsResponseDTO> {
  const clubRow = await requireExistingClub(params.chatId, {
    allowSuperadminBypass: params.viewerIsSuperadmin,
  });
  const clubSummary = await mapClubRowToSummaryDTO(
    clubRow,
    params.viewerTelegramId,
    params.viewerIsSuperadmin
  );

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      attempt: challengeAttempts,
      user: users,
    })
    .from(challengeAttempts)
    .leftJoin(users, eq(challengeAttempts.telegramId, users.telegramId))
    .where(
      and(
        eq(challengeAttempts.chatId, params.chatId),
        gte(challengeAttempts.updatedAt, sevenDaysAgo)
      )
    );

  const mapByUser = new Map<string, ClubRecordEntryDTO>();

  for (const r of rows) {
    const att = r.attempt;
    const usr = r.user;
    const displayName = usr
      ? usr.username
        ? `@${usr.username}`
        : usr.firstName
      : att.username;

    let entry = mapByUser.get(att.telegramId);
    if (!entry) {
      entry = {
        rank: 0,
        telegram_id: att.telegramId,
        username: att.username,
        display_name: displayName,
        avatar_url: usr?.avatarUrl ?? null,
        total_points: 0,
        tactics_points: 0,
        finishhim_points: 0,
        practical_points: 0,
        theoretical_points: 0,
        total_time_ms: 0,
        total_seconds: 0,
        solved_count: 0,
        attempted_puzzles: 0,
        total_attempts: 0,
      };
      mapByUser.set(att.telegramId, entry);
    }

    entry.attempted_puzzles += 1;
    entry.total_attempts += att.attempts;

    if (att.solved) {
      const pts = calculateAttemptPoints(att.solved, att.attempts);
      entry.solved_count += 1;
      entry.total_points += pts;
      entry.total_time_ms += Number(att.solvedTimeMs ?? 0);

      if (att.discipline === "tactics") entry.tactics_points += pts;
      else if (att.discipline === "finishhim") entry.finishhim_points += pts;
      else if (att.discipline === "practical_chess")
        entry.practical_points += pts;
      else if (att.discipline === "theoretical_endgames")
        entry.theoretical_points += pts;
    }
  }

  const records = Array.from(mapByUser.values());
  records.sort((a, b) => {
    if (b.total_points !== a.total_points) {
      return b.total_points - a.total_points;
    }
    if (a.total_time_ms !== b.total_time_ms) {
      return a.total_time_ms - b.total_time_ms;
    }
    return a.total_attempts - b.total_attempts;
  });

  records.forEach((rec, idx) => {
    rec.rank = idx + 1;
    rec.total_points = roundPoints(rec.total_points);
    rec.tactics_points = roundPoints(rec.tactics_points);
    rec.finishhim_points = roundPoints(rec.finishhim_points);
    rec.practical_points = roundPoints(rec.practical_points);
    rec.theoretical_points = roundPoints(rec.theoretical_points);
    rec.total_seconds = Math.round((rec.total_time_ms / 1000) * 10) / 10;
  });

  const rawChallenges = await db
    .select()
    .from(clubChallenges)
    .where(eq(clubChallenges.chatId, params.chatId))
    .orderBy(desc(clubChallenges.publishedAt))
    .limit(50);

  const now = new Date();
  const recentChallenges = rawChallenges.filter((c) =>
    isSameDayInTimezone(c.publishedAt, now, clubRow.timezone)
  );

  interface ChallengeStatsBucket {
    solvedCount: number;
    bestTimeMs: number | null;
    myStatus: ChallengeAttemptStatus | null;
    mySolved: boolean;
    myPoints: number;
    myAttempts: number;
  }

  const statsByChallengeKey = new Map<string, ChallengeStatsBucket>();
  for (const r of rows) {
    const att = r.attempt;
    const key = `${att.discipline}:${att.puzzleId}:${att.edition}`;
    let bucket = statsByChallengeKey.get(key);
    if (!bucket) {
      bucket = {
        solvedCount: 0,
        bestTimeMs: null,
        myStatus: null,
        mySolved: false,
        myPoints: 0,
        myAttempts: 0,
      };
      statsByChallengeKey.set(key, bucket);
    }

    if (att.solved) {
      bucket.solvedCount += 1;
      if (att.solvedTimeMs !== null && att.solvedTimeMs !== undefined) {
        const ms = Number(att.solvedTimeMs);
        if (bucket.bestTimeMs === null || ms < bucket.bestTimeMs) {
          bucket.bestTimeMs = ms;
        }
      }
    }

    if (att.telegramId === params.viewerTelegramId) {
      bucket.myStatus = (att.status || "in_progress") as ChallengeAttemptStatus;
      bucket.mySolved = att.solved;
      bucket.myPoints = roundPoints(
        calculateAttemptPoints(att.solved, att.attempts)
      );
      bucket.myAttempts = att.attempts;
    }
  }

  const challengeItems: ClubChallengeItemDTO[] = recentChallenges.map((c) => {
    const key = `${c.discipline}:${c.puzzleId}:${c.edition}`;
    const b = statsByChallengeKey.get(key);
    return {
      discipline: c.discipline as ChallengeDiscipline,
      puzzle_id: c.puzzleId,
      edition: c.edition,
      difficulty: c.difficulty as ChallengeDifficulty,
      category: c.category || c.domain || "MIX",
      domain: c.domain || "",
      published_at: c.publishedAt.toISOString(),
      solved_count: b?.solvedCount ?? 0,
      best_time_ms: b?.bestTimeMs ?? null,
      my_status: b?.myStatus ?? null,
      my_solved: b?.mySolved ?? false,
      my_points: b?.myPoints ?? 0,
      my_attempts: b?.myAttempts ?? 0,
    };
  });

  return {
    club: clubSummary,
    records,
    recent_challenges: challengeItems,
  };
}
