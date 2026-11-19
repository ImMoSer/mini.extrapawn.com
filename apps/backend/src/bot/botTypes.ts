import type { ChallengeDifficulty, ChallengeDiscipline } from "shared";
import type { TelegramCallbackQueryPayload } from "./clubModeration.js";

export interface TelegramUserPayload {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChatMemberPayload {
  status: string;
  user: TelegramUserPayload;
  is_anonymous?: boolean;
  can_manage_chat?: boolean;
  can_delete_messages?: boolean;
  can_manage_topics?: boolean;
}

export interface TelegramChatPayload {
  id: number;
  type: string;
  title?: string;
  username?: string;
  is_forum?: boolean;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: TelegramUserPayload;
    chat: TelegramChatPayload;
    text?: string;
  };
  my_chat_member?: {
    chat: TelegramChatPayload;
    from: TelegramUserPayload;
    old_chat_member?: TelegramChatMemberPayload;
    new_chat_member: TelegramChatMemberPayload;
  };
  chat_member?: {
    chat: TelegramChatPayload;
    from: TelegramUserPayload;
    old_chat_member: TelegramChatMemberPayload;
    new_chat_member: TelegramChatMemberPayload;
  };
  callback_query?: TelegramCallbackQueryPayload;
}

export interface ClubPublishOverride {
  discipline?: ChallengeDiscipline;
  difficulty?: ChallengeDifficulty;
  focusGroup?: string;
  focusKey?: string;
  objective?: string;
  puzzleId?: string;
}

export interface PromoBroadcastPayload {
  fileId: string | null;
  textRu: string;
  textEn: string;
  textDe: string;
  buttonRu: string | null;
  buttonEn: string | null;
  buttonDe: string | null;
  targetUrl: string | null;
}
