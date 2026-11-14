import { and, count, eq } from "drizzle-orm";
import {
  normalizeWeeklySchedule,
  type AppLanguage,
  type ChallengeDifficulty,
  type ChallengeDiscipline,
  type ClubStatus,
  type ClubSummaryDTO,
} from "shared";
import { db } from "../db/index.js";
import { clubAdmins, clubChallenges, clubs } from "../db/schema.js";

export async function mapClubRowToSummaryDTO(
  row: typeof clubs.$inferSelect,
  viewerTelegramId: string,
  viewerIsSuperadmin: boolean
): Promise<ClubSummaryDTO> {
  let isAdmin = viewerIsSuperadmin;

  if (!isAdmin) {
    const [adminRow] = await db
      .select({ telegramId: clubAdmins.telegramId })
      .from(clubAdmins)
      .where(
        and(
          eq(clubAdmins.chatId, row.chatId),
          eq(clubAdmins.telegramId, viewerTelegramId)
        )
      )
      .limit(1);
    isAdmin = Boolean(adminRow);
  }

  const [countRes] = await db
    .select({ value: count() })
    .from(clubChallenges)
    .where(eq(clubChallenges.chatId, row.chatId));

  const status = (row.status || "active") as ClubStatus;
  const isActive = Boolean(row.isActive) && status === "active";

  return {
    chat_id: row.chatId,
    title: row.title,
    username: row.username,
    invite_link: row.inviteLink,
    owner_telegram_id: row.ownerTelegramId,
    topic_thread_id: row.topicThreadId,
    member_count: row.memberCount,
    language: (row.language || "ru") as AppLanguage,
    timezone: row.timezone,
    status,
    is_active: isActive,
    auto_paused: Boolean(row.autoPaused),
    blocked_reason: row.blockedReason,
    is_admin: isAdmin,
    weekly_schedule: normalizeWeeklySchedule(row.weeklySchedule),
    schedule_times: row.scheduleTimes || ["09:00", "15:00", "20:00"],
    leaderboard_cron_days: row.leaderboardCronDays,
    filter_disciplines: (row.filterDisciplines || [
      "tactics",
      "theoretical_endgames",
      "practical_chess",
      "finishhim",
    ]) as ChallengeDiscipline[],
    filter_difficulties: (row.filterDifficulties || [
      "Novice",
      "Pro",
      "Master",
    ]) as ChallengeDifficulty[],
    filter_focus_group: row.filterFocusGroup || "all",
    filter_focus_keys: row.filterFocusKeys || ["all"],
    filter_objective: row.filterObjective || "all",
    last_published_at: row.lastPublishedAt
      ? row.lastPublishedAt.toISOString()
      : null,
    published_challenges_count: Number(countRes?.value ?? 0),
  };
}

