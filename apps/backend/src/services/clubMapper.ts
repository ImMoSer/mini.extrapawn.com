import { count, eq } from "drizzle-orm";
import type {
  AppLanguage,
  ChallengeDifficulty,
  ChallengeDiscipline,
  ClubStatus,
  ClubSummaryDTO,
} from "shared";
import { db } from "../db/index.js";
import { clubAdmins, clubChallenges, clubs } from "../db/schema.js";

export async function mapClubRowToSummaryDTO(
  row: typeof clubs.$inferSelect,
  viewerTelegramId: string,
  viewerIsSuperadmin: boolean
): Promise<ClubSummaryDTO> {
  let isAdmin =
    viewerIsSuperadmin || row.ownerTelegramId === viewerTelegramId;

  if (!isAdmin) {
    const adminRows = await db
      .select()
      .from(clubAdmins)
      .where(eq(clubAdmins.chatId, row.chatId));
    isAdmin = adminRows.some((a) => a.telegramId === viewerTelegramId);
  }

  const [countRes] = await db
    .select({ value: count() })
    .from(clubChallenges)
    .where(eq(clubChallenges.chatId, row.chatId));

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
    status: (row.status || "active") as ClubStatus,
    blocked_reason: row.blockedReason,
    is_default: row.isDefault,
    is_admin: isAdmin,
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

