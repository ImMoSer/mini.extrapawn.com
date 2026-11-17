import { and, desc, eq, gte, ne } from "drizzle-orm";
import {
  calculateAttemptPoints,
  roundPoints,
  type ClubCompetitionRowDTO,
  type ClubsCompetitionResponseDTO,
} from "shared";
import { db } from "../db/index.js";
import { challengeAttempts, clubAdmins, clubs } from "../db/schema.js";

export async function buildClubsCompetitionLeaderboard(params: {
  viewerTelegramId: string;
  viewerIsSuperadmin: boolean;
}): Promise<ClubsCompetitionResponseDTO> {
  const periodDays = 7;
  const sinceDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
  const viewerId = params.viewerTelegramId;

  const clubRows = await db
    .select()
    .from(clubs)
    .where(
      and(
        ne(clubs.status, "blocked"),
        ne(clubs.status, "bot_removed"),
        ne(clubs.status, "pending")
      )
    )
    .orderBy(desc(clubs.memberCount));

  const [recentSolved, myAttempts, myAdminRows] = await Promise.all([
    db
      .select()
      .from(challengeAttempts)
      .where(
        and(
          eq(challengeAttempts.solved, true),
          gte(challengeAttempts.updatedAt, sinceDate)
        )
      ),
    db
      .select({ chatId: challengeAttempts.chatId })
      .from(challengeAttempts)
      .where(eq(challengeAttempts.telegramId, viewerId)),
    db
      .select({ chatId: clubAdmins.chatId })
      .from(clubAdmins)
      .where(eq(clubAdmins.telegramId, viewerId)),
  ]);

  const participatedChatIds = new Set(myAttempts.map((a) => a.chatId));
  const adminChatIds = new Set(myAdminRows.map((a) => a.chatId));

  interface ClubAccumulator {
    tactics: number;
    theoretical: number;
    practical: number;
    finishhim: number;
    solvedCount: number;
    players: Set<string>;
  }

  const accByChatId = new Map<string, ClubAccumulator>();
  for (const att of recentSolved) {
    let acc = accByChatId.get(att.chatId);
    if (!acc) {
      acc = {
        tactics: 0,
        theoretical: 0,
        practical: 0,
        finishhim: 0,
        solvedCount: 0,
        players: new Set<string>(),
      };
      accByChatId.set(att.chatId, acc);
    }

    const pts = calculateAttemptPoints(att.solved, att.attempts);
    acc.solvedCount += 1;
    acc.players.add(att.telegramId);

    if (att.discipline === "tactics") acc.tactics += pts;
    else if (att.discipline === "theoretical_endgames") acc.theoretical += pts;
    else if (att.discipline === "practical_chess") acc.practical += pts;
    else if (att.discipline === "finishhim") acc.finishhim += pts;
  }

  const rows: ClubCompetitionRowDTO[] = clubRows.map((c) => {
    const acc = accByChatId.get(c.chatId);
    const tacticsPts = roundPoints(acc?.tactics ?? 0);
    const theoreticalPts = roundPoints(acc?.theoretical ?? 0);
    const practicalPts = roundPoints(acc?.practical ?? 0);
    const finishhimPts = roundPoints(acc?.finishhim ?? 0);
    const totalPts = roundPoints(
      tacticsPts + theoreticalPts + practicalPts + finishhimPts
    );
    const avgPts = roundPoints(totalPts / 4);
    const isAdmin = params.viewerIsSuperadmin || adminChatIds.has(c.chatId);
    const isMember = isAdmin || participatedChatIds.has(c.chatId);
    const isActive = Boolean(c.isActive) && c.status === "active";

    return {
      rank: 0,
      chat_id: c.chatId,
      title: c.title,
      username: c.username ?? null,
      is_member: isMember,
      is_admin: isAdmin,
      is_active: isActive,
      auto_paused: Boolean(c.autoPaused),
      member_count: c.memberCount,
      active_players_7d: acc ? acc.players.size : 0,
      solved_count_7d: acc?.solvedCount ?? 0,
      tactics_points: tacticsPts,
      theoretical_points: theoreticalPts,
      practical_points: practicalPts,
      finishhim_points: finishhimPts,
      total_points: totalPts,
      average_points: avgPts,
    };
  });

  rows.sort((a, b) => {
    if (b.total_points !== a.total_points) {
      return b.total_points - a.total_points;
    }
    if (b.solved_count_7d !== a.solved_count_7d) {
      return b.solved_count_7d - a.solved_count_7d;
    }
    return b.member_count - a.member_count;
  });

  rows.forEach((r, idx) => {
    r.rank = idx + 1;
  });

  return {
    period_days: periodDays,
    clubs: rows,
  };
}
