import type { AppLanguage } from "shared";
import {
  resolveClubAdminRole,
  syncClubAdminsFromTelegram,
  verifyBotHasClubPermissions,
  verifyLiveClubManager,
} from "./botAdminSync.js";
import {
  checkAndResumeAutoPause,
  clearAutoPause,
  findLatestUnresolvedChallenge,
} from "./botAutoPause.js";
import {
  broadcastPromoCampaign,
  publishChallengeToClub,
} from "./botChallengePublisher.js";
import {
  handleChatMemberUpdate,
  handleMyChatMemberUpdate,
} from "./botClubOnboarding.js";
import {
  leaveClubChat,
  sendBlockedClubNoticeAndLeave,
} from "./botIncidents.js";
import {
  type NotifyChallengeSolvedParams,
  sendChallengeSolvedNotification,
  sendClubSettingsUpdatedNotification,
} from "./botNotifications.js";
import { startTelegramBotBackgroundLoops } from "./botScheduler.js";
import { setPendingOnboardingLanguageInternal } from "./botTexts.js";
import type {
  ClubPublishOverride,
  PromoBroadcastPayload,
  TelegramChatMemberPayload,
  TelegramUpdate,
  TelegramUserPayload,
} from "./botTypes.js";
import { approvePendingClub, rejectPendingClub } from "./clubModeration.js";

export type { TelegramChatMemberPayload, TelegramUserPayload };
export { resolveClubAdminRole, startTelegramBotBackgroundLoops };

const moderationDeps = {
  verifyBotHasClubPermissions: (id: string, lang?: string | null) =>
    verifyBotHasClubPermissions(id, lang),
  publishChallengeToClub: (id: string) => publishChallengeToClub(id),
  leaveClubChat: (id: string, msg?: string) => leaveClubChat(id, msg),
  clearAutoPause: (id: string) => clearAutoPause(id),
};

export const telegramBotService = {
  publishChallengeToClub(chatId: string, override?: ClubPublishOverride) {
    return publishChallengeToClub(chatId, override);
  },

  notifyChallengeSolved(params: NotifyChallengeSolvedParams): Promise<void> {
    return sendChallengeSolvedNotification(params);
  },

  notifyClubSettingsUpdated(params: {
    chatId: string;
    firstName: string;
  }): Promise<void> {
    return sendClubSettingsUpdatedNotification(params);
  },

  leaveClubChat(chatId: string, reasonMessage?: string): Promise<void> {
    return leaveClubChat(chatId, reasonMessage);
  },

  sendBlockedClubNoticeAndLeave(
    chatId: string,
    topicThreadId?: number,
    rawLang?: string | null
  ): Promise<void> {
    return sendBlockedClubNoticeAndLeave(chatId, topicThreadId, rawLang);
  },

  broadcastPromoCampaign(promo: PromoBroadcastPayload): Promise<number> {
    return broadcastPromoCampaign(promo);
  },

  syncClubAdminsFromTelegram(chatId: string) {
    return syncClubAdminsFromTelegram(chatId);
  },

  verifyLiveClubManager(
    chatId: string,
    telegramId: string,
    options?: { forceFresh?: boolean }
  ): Promise<boolean> {
    return verifyLiveClubManager(chatId, telegramId, options);
  },

  setPendingOnboardingLanguage(
    telegramId: string,
    language: AppLanguage
  ): void {
    setPendingOnboardingLanguageInternal(telegramId, language);
  },

  verifyBotHasClubPermissions(chatId: string, rawLang?: string | null) {
    return verifyBotHasClubPermissions(chatId, rawLang);
  },

  handleChatMemberUpdate(
    update: NonNullable<TelegramUpdate["chat_member"]>
  ): Promise<void> {
    return handleChatMemberUpdate(update);
  },

  handleMyChatMemberUpdate(
    update: NonNullable<TelegramUpdate["my_chat_member"]>
  ): Promise<void> {
    return handleMyChatMemberUpdate(update);
  },

  approveClubApplication(chatId: string) {
    return approvePendingClub(chatId, moderationDeps);
  },

  rejectClubApplication(chatId: string) {
    return rejectPendingClub(chatId, moderationDeps);
  },

  findLatestUnresolvedChallenge(chatId: string) {
    return findLatestUnresolvedChallenge(chatId);
  },

  clearAutoPause(chatId: string): Promise<void> {
    return clearAutoPause(chatId);
  },

  checkAndResumeAutoPause(chatId: string): Promise<void> {
    return checkAndResumeAutoPause(chatId);
  },
};
