import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import {
  calculateAttemptPoints,
  isSameDayInTimezone,
  roundPoints,
  type BotEngineId,
  type ChallengeAttemptStatus,
  type ChallengeDifficulty,
  type ChallengeDiscipline,
  type ChallengeParticipantDTO,
  type ChallengeStateDTO,
  type ClubChallengeItemDTO,
  type ClubRecordEntryDTO,
  type ClubRecordsResponseDTO,
  type GoActiveChallengeItemDTO,
  type GoActiveChallengesResponseDTO,
  type NextActiveChallengeRefDTO,
  type PuzzleObjective,
  type PuzzleStrategyType,
  type SubmitChallengeAttemptRequest,
} from "shared";
import { env } from "../config/env.js";
import { telegramBotService } from "../bot/telegramBot.service.js";
import { db } from "../db/index.js";
import {
  challengeAttempts,
  clubAdmins,
  clubChallenges,
  clubs,
  users,
} from "../db/schema.js";
import { renderBoardPng } from "../services/boardImage.service.js";
import { mapClubRowToSummaryDTO } from "../services/clubMapper.js";
import { puzzleClientService } from "../services/puzzleClient.service.js";

interface ChallengeRouteParams {
  discipline: ChallengeDiscipline;
  puzzleId: string;
  edition: string;
  chatId: string;
}

async function ensureClubExists(chatId: string) {
  const [existing] = await db
    .select()
    .from(clubs)
    .where(eq(clubs.chatId, chatId))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(clubs)
    .values({
      chatId,
      title: `Club ${chatId}`,
      ownerTelegramId: env.SUPERADMIN_TELEGRAM_ID,
      topicThreadId: 0,
      status: "active",
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const [refetched] = await db
    .select()
    .from(clubs)
    .where(eq(clubs.chatId, chatId))
    .limit(1);

  if (!refetched) {
    throw new Error(`[ChallengesRoute] Failed to ensure club ${chatId}`);
  }
  return refetched;
}

async function isChallengeExpiredForViewer(params: {
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

  if (isSameDayInTimezone(challengeRow.publishedAt, new Date(), params.clubTimezone)) {
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
async function getViewerTodayActiveChallenges(params: {
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

async function computeViewerNextActive(params: {
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

async function buildChallengeStateDTO(params: {
  chatId: string;
  discipline: ChallengeDiscipline;
  puzzleId: string;
  edition: string;
  viewerTelegramId: string;
  viewerDisplayName: string;
  viewerIsSuperadmin: boolean;
}): Promise<ChallengeStateDTO> {
  const club = await ensureClubExists(params.chatId);

  // Fetch raw puzzle from puzzle_service
  const normalized = await puzzleClientService.getPuzzleById(
    params.discipline,
    params.puzzleId
  );

  // Ensure club_challenges entry exists so puzzleFen is consistent across all users
  let [challengeRow] = await db
    .select()
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
    const [inserted] = await db
      .insert(clubChallenges)
      .values({
        chatId: params.chatId,
        discipline: params.discipline,
        puzzleId: params.puzzleId,
        edition: params.edition,
        difficulty: normalized.difficulty,
        botEngine: normalized.botEngine,
        initialFen: normalized.initialFen,
        puzzleFen: normalized.puzzleFen,
        userColor: normalized.userColor,
        firstMove: normalized.firstMove,
        strategy: normalized.strategy,
        objective: normalized.objective,
        tacticalSolution: normalized.tacticalSolution,
        domain: normalized.domain,
        category: normalized.category,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted) {
      challengeRow = inserted;
    } else {
      const [refetched] = await db
        .select()
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
      challengeRow = refetched;
    }
  }

  // Ensure current user has an attempt row registered (`in_progress`)
  await db
    .insert(challengeAttempts)
    .values({
      chatId: params.chatId,
      discipline: params.discipline,
      puzzleId: params.puzzleId,
      edition: params.edition,
      telegramId: params.viewerTelegramId,
      username: params.viewerDisplayName,
      status: "in_progress",
      solved: false,
      attempts: 0,
    })
    .onConflictDoNothing();

  // Load all attempts for this challenge + user details
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
        eq(challengeAttempts.discipline, params.discipline),
        eq(challengeAttempts.puzzleId, params.puzzleId),
        eq(challengeAttempts.edition, params.edition)
      )
    );

  // Sort: solved DESC -> attempts ASC (for solved) -> solvedTimeMs ASC -> updatedAt ASC
  rows.sort((a, b) => {
    if (a.attempt.solved !== b.attempt.solved) {
      return a.attempt.solved ? -1 : 1;
    }
    if (a.attempt.solved && b.attempt.solved) {
      if (a.attempt.attempts !== b.attempt.attempts) {
        return a.attempt.attempts - b.attempt.attempts;
      }
      const timeA = a.attempt.solvedTimeMs ?? Number.MAX_SAFE_INTEGER;
      const timeB = b.attempt.solvedTimeMs ?? Number.MAX_SAFE_INTEGER;
      if (timeA !== timeB) {
        return timeA - timeB;
      }
    }
    if (a.attempt.attempts !== b.attempt.attempts) {
      return b.attempt.attempts - a.attempt.attempts;
    }
    return (
      new Date(a.attempt.updatedAt).getTime() -
      new Date(b.attempt.updatedAt).getTime()
    );
  });

  const viewerAttempt = rows.find(
    (r) => r.attempt.telegramId === params.viewerTelegramId
  )?.attempt;

  const canRevealOtherSolutions =
    viewerAttempt?.status === "solved" ||
    viewerAttempt?.status === "surrendered";

  const leaderboard: ChallengeParticipantDTO[] = rows.map((r, idx) => {
    const att = r.attempt;
    const usr = r.user;
    const isViewer = att.telegramId === params.viewerTelegramId;
    const points = roundPoints(calculateAttemptPoints(att.solved, att.attempts));
    const scorePoints = att.solved ? 1 : 0;
    const denom = att.solved && att.attempts === 0 ? 1 : att.attempts;
    const scoreText = `${scorePoints}/${denom}`;

    const displayName = usr?.firstName || att.username;

    return {
      rank: idx + 1,
      telegram_id: att.telegramId,
      username: att.username,
      display_name: displayName,
      avatar_url: usr?.avatarUrl ?? null,
      status: (att.status || "in_progress") as ChallengeAttemptStatus,
      solved: att.solved,
      attempts: att.attempts,
      points,
      score_text: scoreText,
      solved_time_ms: att.solvedTimeMs ?? null,
      uci_moves: canRevealOtherSolutions || isViewer ? att.uciMoves : "",
      pgn_moves: canRevealOtherSolutions || isViewer ? att.pgnMoves : "",
      updated_at: att.updatedAt.toISOString(),
      completed_at: att.completedAt ? att.completedAt.toISOString() : null,
    };
  });

  const myEntry =
    leaderboard.find((p) => p.telegram_id === params.viewerTelegramId) ?? null;

  const nextActiveInfo = await computeViewerNextActive({
    chatId: params.chatId,
    viewerTelegramId: params.viewerTelegramId,
    viewerIsSuperadmin: params.viewerIsSuperadmin,
    exclude: {
      discipline: params.discipline,
      puzzleId: params.puzzleId,
      edition: params.edition,
    },
  });

  return {
    chat_id: params.chatId,
    club_title: club.title,
    discipline: params.discipline,
    puzzle_id: params.puzzleId,
    edition: params.edition,
    difficulty: (challengeRow?.difficulty ||
      normalized.difficulty) as ChallengeDifficulty,
    bot_engine: (challengeRow?.botEngine ||
      normalized.botEngine) as BotEngineId,
    initial_fen: challengeRow?.initialFen || normalized.initialFen,
    puzzle_fen: challengeRow?.puzzleFen || normalized.puzzleFen,
    user_color: (challengeRow?.userColor || normalized.userColor) as
      | "white"
      | "black",
    first_move: (challengeRow?.firstMove || normalized.firstMove) as
      | "bot"
      | "user",
    strategy: (challengeRow?.strategy ||
      normalized.strategy) as PuzzleStrategyType,
    objective: (challengeRow?.objective ||
      normalized.objective) as PuzzleObjective,
    tactical_solution:
      challengeRow?.tacticalSolution ?? normalized.tacticalSolution,
    domain: challengeRow?.domain || normalized.domain,
    category: challengeRow?.category || normalized.category,
    tactical: normalized.tactical,
    endgame: normalized.endgame,
    my_entry: myEntry,
    leaderboard,
    remaining_active_count: nextActiveInfo.remainingActiveCount,
    next_active_challenge: nextActiveInfo.nextActiveChallenge,
  };
}

export const challengesRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. Dynamic board.png generator
  fastify.get<{
    Querystring: {
      fen: string;
      orientation?: "white" | "black";
      lastMove?: string;
    };
  }>("/challenges/board-png", async (req, reply) => {
    const fen = req.query.fen?.trim();
    if (!fen) {
      return reply.code(400).send({ error: "Missing 'fen' query parameter" });
    }
    const orientation =
      req.query.orientation === "black" ? "black" : "white";
    const png = renderBoardPng({
      fen,
      orientation,
      lastMoveUci: req.query.lastMove?.trim(),
    });
    return reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", "public, max-age=86400")
      .send(png);
  });

  // 1b. Active today challenges across all clubs where user participates (/api/challenges/go-feed)
  fastify.get(
    "/challenges/go-feed",
    { preHandler: [fastify.authenticate] },
    async (req): Promise<GoActiveChallengesResponseDTO> => {
      const challenges = await getViewerTodayActiveChallenges({
        viewerTelegramId: req.user.telegramId,
        isSuperadmin: req.user.isSuperadmin,
      });
      return { challenges };
    }
  );

  // 2. Club-wide aggregated leaderboard (/api/challenges/records/:chatId)
  fastify.get<{ Params: { chatId: string } }>(
    "/challenges/records/:chatId",
    { preHandler: [fastify.authenticate] },
    async (req) => {
      const chatId = req.params.chatId;
      const clubRow = await ensureClubExists(chatId);
      const clubSummary = await mapClubRowToSummaryDTO(
        clubRow,
        req.user.telegramId,
        req.user.isSuperadmin
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
            eq(challengeAttempts.chatId, chatId),
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
        .where(eq(clubChallenges.chatId, chatId))
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

        if (att.telegramId === req.user.telegramId) {
          bucket.myStatus = (att.status || "in_progress") as ChallengeAttemptStatus;
          bucket.mySolved = att.solved;
          bucket.myPoints = roundPoints(
            calculateAttemptPoints(att.solved, att.attempts)
          );
          bucket.myAttempts = att.attempts;
        }
      }

      const challengeItems: ClubChallengeItemDTO[] = recentChallenges.map(
        (c) => {
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
        }
      );

      const response: ClubRecordsResponseDTO = {
        club: clubSummary,
        records,
        recent_challenges: challengeItems,
      };

      return response;
    }
  );

  // 3. Get Challenge State & Per-Puzzle Leaderboard
  fastify.get<{ Params: ChallengeRouteParams }>(
    "/challenges/:discipline/:puzzleId/:edition/:chatId",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const { discipline, puzzleId, edition, chatId } = req.params;
      const safeEdition = edition || "0";
      const displayName = req.user.firstName;
      const club = await ensureClubExists(chatId);

      const expired = await isChallengeExpiredForViewer({
        chatId,
        discipline,
        puzzleId,
        edition: safeEdition,
        viewerTelegramId: req.user.telegramId,
        clubTimezone: club.timezone,
      });
      if (expired) {
        return reply.code(410).send({
          error: "Challenge expired. Only today's challenges can be solved.",
        });
      }

      return buildChallengeStateDTO({
        chatId,
        discipline,
        puzzleId,
        edition: safeEdition,
        viewerTelegramId: req.user.telegramId,
        viewerDisplayName: displayName,
        viewerIsSuperadmin: req.user.isSuperadmin,
      });
    }
  );

  // 4. Submit Challenge Attempt (wrong move or solved completion)
  fastify.post<{
    Params: ChallengeRouteParams;
    Body: SubmitChallengeAttemptRequest;
  }>(
    "/challenges/:discipline/:puzzleId/:edition/:chatId/attempt",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const { discipline, puzzleId, edition, chatId } = req.params;
      const safeEdition = edition || "0";
      const displayName = req.user.firstName;
      const { solved, time_ms, uci_moves = "", pgn_moves = "" } = req.body;

      const club = await ensureClubExists(chatId);
      const expired = await isChallengeExpiredForViewer({
        chatId,
        discipline,
        puzzleId,
        edition: safeEdition,
        viewerTelegramId: req.user.telegramId,
        clubTimezone: club.timezone,
      });
      if (expired) {
        return reply.code(410).send({
          error: "Challenge expired. Only today's challenges can be solved.",
        });
      }

      // Ensure attempt row exists first
      await db
        .insert(challengeAttempts)
        .values({
          chatId,
          discipline,
          puzzleId,
          edition: safeEdition,
          telegramId: req.user.telegramId,
          username: displayName,
          status: "in_progress",
          solved: false,
          attempts: 0,
        })
        .onConflictDoNothing();

      const [current] = await db
        .select()
        .from(challengeAttempts)
        .where(
          and(
            eq(challengeAttempts.chatId, chatId),
            eq(challengeAttempts.discipline, discipline),
            eq(challengeAttempts.puzzleId, puzzleId),
            eq(challengeAttempts.edition, safeEdition),
            eq(challengeAttempts.telegramId, req.user.telegramId)
          )
        )
        .limit(1);

      if (
        current &&
        current.status !== "solved" &&
        current.status !== "surrendered"
      ) {
        const nextAttempts = current.attempts + 1;
        const nextStatus: ChallengeAttemptStatus = solved
          ? "solved"
          : "in_progress";
        const shouldNotify = solved && !current.notifiedAt;

        await db
          .update(challengeAttempts)
          .set({
            username: displayName,
            status: nextStatus,
            solved: solved ? true : current.solved,
            attempts: nextAttempts,
            solvedTimeMs: solved ? Math.max(0, Math.round(time_ms)) : null,
            uciMoves: solved ? uci_moves.trim() : current.uciMoves,
            pgnMoves: solved ? pgn_moves.trim() : current.pgnMoves,
            notifiedAt: shouldNotify ? new Date() : current.notifiedAt,
            updatedAt: new Date(),
            completedAt: solved ? new Date() : null,
          })
          .where(eq(challengeAttempts.id, current.id));

        if (solved) {
          await telegramBotService.checkAndResumeAutoPause(chatId);
        }

        if (shouldNotify) {
          void telegramBotService
            .notifyChallengeSolved({
              chatId,
              discipline,
              puzzleId,
              edition: safeEdition,
              username: req.user.firstName,
              attempts: nextAttempts,
              timeMs: Math.max(0, Math.round(time_ms)),
            })
            .catch((err) => {
              req.log.error(
                err,
                "[ChallengesRoute] Failed to send Telegram solve notification"
              );
            });
        }
      }

      return buildChallengeStateDTO({
        chatId,
        discipline,
        puzzleId,
        edition: safeEdition,
        viewerTelegramId: req.user.telegramId,
        viewerDisplayName: displayName,
        viewerIsSuperadmin: req.user.isSuperadmin,
      });
    }
  );

  // 5. Surrender Challenge (locks status='surrendered' and unlocks analysis & viewing others' solutions)
  fastify.post<{ Params: ChallengeRouteParams }>(
    "/challenges/:discipline/:puzzleId/:edition/:chatId/surrender",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const { discipline, puzzleId, edition, chatId } = req.params;
      const safeEdition = edition || "0";
      const displayName = req.user.firstName;

      const club = await ensureClubExists(chatId);
      const expired = await isChallengeExpiredForViewer({
        chatId,
        discipline,
        puzzleId,
        edition: safeEdition,
        viewerTelegramId: req.user.telegramId,
        clubTimezone: club.timezone,
      });
      if (expired) {
        return reply.code(410).send({
          error: "Challenge expired. Only today's challenges can be solved.",
        });
      }

      await db
        .insert(challengeAttempts)
        .values({
          chatId,
          discipline,
          puzzleId,
          edition: safeEdition,
          telegramId: req.user.telegramId,
          username: displayName,
          status: "surrendered",
          solved: false,
          attempts: 1,
          completedAt: new Date(),
        })
        .onConflictDoNothing();

      const [current] = await db
        .select()
        .from(challengeAttempts)
        .where(
          and(
            eq(challengeAttempts.chatId, chatId),
            eq(challengeAttempts.discipline, discipline),
            eq(challengeAttempts.puzzleId, puzzleId),
            eq(challengeAttempts.edition, safeEdition),
            eq(challengeAttempts.telegramId, req.user.telegramId)
          )
        )
        .limit(1);

      if (current && current.status === "in_progress") {
        await db
          .update(challengeAttempts)
          .set({
            status: "surrendered",
            attempts: Math.max(1, current.attempts),
            updatedAt: new Date(),
            completedAt: new Date(),
          })
          .where(eq(challengeAttempts.id, current.id));
      }

      await telegramBotService.checkAndResumeAutoPause(chatId);

      return buildChallengeStateDTO({
        chatId,
        discipline,
        puzzleId,
        edition: safeEdition,
        viewerTelegramId: req.user.telegramId,
        viewerDisplayName: displayName,
        viewerIsSuperadmin: req.user.isSuperadmin,
      });
    }
  );
};

