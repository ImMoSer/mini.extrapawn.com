import { and, desc, eq, ne, or } from "drizzle-orm";
import {
  ALL_DAYS_OF_WEEK,
  calculateAttemptPoints,
  createDefaultWeeklySchedule,
  encodeChallengeStartParam,
  encodeClubLeaderboardStartParam,
  formatFocusLabel,
  MAX_OWNED_CLUBS_PER_USER,
  normalizeWeeklySchedule,
  roundPoints,
  type AppLanguage,
  type ChallengeDifficulty,
  type ChallengeDiscipline,
  type ClubScheduleSlot,
  type DayOfWeekKey,
} from "shared";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import {
  challengeAttempts,
  clubAdmins,
  clubChallenges,
  clubs,
  users,
} from "../db/schema.js";
import { renderBoardPng } from "../services/boardImage.service.js";
import {
  type NormalizedChallengePuzzle,
  puzzleClientService,
} from "../services/puzzleClient.service.js";

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
    };
    text?: string;
  };
  my_chat_member?: {
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
      is_forum?: boolean;
    };
    from: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    new_chat_member: {
      status: string;
      can_manage_topics?: boolean;
    };
  };
}

const DISCIPLINE_LABELS: Record<
  AppLanguage,
  Record<ChallengeDiscipline, string>
> = {
  ru: {
    tactics: "Тактика",
    theoretical_endgames: "Теоретический эндшпиль",
    practical_chess: "Практический эндшпиль",
    finishhim: "Добивание (Finish Him)",
  },
  en: {
    tactics: "Tactics",
    theoretical_endgames: "Theoretical Endgame",
    practical_chess: "Practical Endgame",
    finishhim: "Finish Him",
  },
  de: {
    tactics: "Taktik",
    theoretical_endgames: "Endspieltheorie",
    practical_chess: "Praktisches Endspiel",
    finishhim: "Finish Him",
  },
};

const PLAIN_DIFFICULTY_LABELS: Record<
  AppLanguage,
  Record<ChallengeDifficulty, string>
> = {
  ru: {
    Novice: "Новичок",
    Pro: "Профи",
    Master: "Мастер",
  },
  en: {
    Novice: "Novice",
    Pro: "Pro",
    Master: "Master",
  },
  de: {
    Novice: "Einsteiger",
    Pro: "Profi",
    Master: "Meister",
  },
};

const DIFFICULTY_LABELS: Record<
  AppLanguage,
  Record<ChallengeDifficulty, string>
> = {
  ru: {
    Novice: "Новичок (Maia 1500)",
    Pro: "Профи (Maia 2200)",
    Master: "Мастер (MOZERO)",
  },
  en: {
    Novice: "Novice (Maia 1500)",
    Pro: "Pro (Maia 2200)",
    Master: "Master (MOZERO)",
  },
  de: {
    Novice: "Einsteiger (Maia 1500)",
    Pro: "Profi (Maia 2200)",
    Master: "Meister (MOZERO)",
  },
};

function normalizeLang(raw: string | null | undefined): AppLanguage {
  if (raw === "en" || raw === "de") return raw;
  return "ru";
}

function buildChallengeCaption(
  puzzle: NormalizedChallengePuzzle,
  rawLang: AppLanguage
): string {
  const lang = normalizeLang(rawLang);
  const discLabel = DISCIPLINE_LABELS[lang][puzzle.discipline];
  const plainDiffLabel = PLAIN_DIFFICULTY_LABELS[lang][puzzle.difficulty];

  const diffLabel =
    puzzle.discipline === "tactics"
      ? plainDiffLabel
      : puzzle.discipline === "theoretical_endgames"
        ? `${plainDiffLabel} (MOZERO)`
        : DIFFICULTY_LABELS[lang][puzzle.difficulty];

  const categoryLabel = formatFocusLabel(
    puzzle.discipline,
    puzzle.category,
    lang
  );

  let goalLabel =
    lang === "en"
      ? "Find the best continuation"
      : lang === "de"
        ? "Beste Fortsetzung finden"
        : "Найти лучшее продолжение";

  if (puzzle.discipline !== "tactics") {
    if (puzzle.objective === "hold_draw") {
      goalLabel =
        lang === "en"
          ? "Hold a draw against the bot"
          : lang === "de"
            ? "Remis gegen den Bot halten"
            : "Удержать ничью против бота";
    } else {
      goalLabel =
        lang === "en"
          ? "Win against the bot"
          : lang === "de"
            ? "Gegen den Bot gewinnen"
            : "Победить бота";
    }
  } else if (puzzle.category.toLowerCase().includes("mate")) {
    goalLabel =
      lang === "en"
        ? "Deliver checkmate"
        : lang === "de"
          ? "Matt setzen"
          : "Поставить мат";
  }

  const turnLabel =
    puzzle.userColor === "white"
      ? lang === "en"
        ? "White to move ⚪"
        : lang === "de"
          ? "Weiß am Zug ⚪"
          : "Белых ⚪"
      : lang === "en"
        ? "Black to move ⚫"
        : lang === "de"
          ? "Schwarz am Zug ⚫"
          : "Черных ⚫";

  if (lang === "en") {
    return [
      `♟ <b>Discipline:</b> ${discLabel}`,
      `⚙️ <b>Difficulty:</b> ${diffLabel}`,
      `🎯 <b>Category:</b> ${categoryLabel}`,
      `⚔️ <b>Goal:</b> ${goalLabel}`,
      `⏳ <b>Turn:</b> ${turnLabel}`,
    ].join("\n");
  }

  if (lang === "de") {
    return [
      `♟ <b>Disziplin:</b> ${discLabel}`,
      `⚙️ <b>Stufe:</b> ${diffLabel}`,
      `🎯 <b>Fokus:</b> ${categoryLabel}`,
      `⚔️ <b>Ziel:</b> ${goalLabel}`,
      `⏳ <b>Am Zug:</b> ${turnLabel}`,
    ].join("\n");
  }

  return [
    `♟ <b>Дисциплина:</b> ${discLabel}`,
    `⚙️ <b>Сложность:</b> ${diffLabel}`,
    `🎯 <b>Категория:</b> ${categoryLabel}`,
    `⚔️ <b>Задача:</b> ${goalLabel}`,
    `⏳ <b>Ход:</b> ${turnLabel}`,
  ].join("\n");
}

async function callTelegramJson<T>(
  method: string,
  payload: Record<string, unknown>
): Promise<TelegramApiResponse<T>> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, description: "TELEGRAM_BOT_TOKEN not set" };
  }
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await res.json()) as TelegramApiResponse<T>;
}

async function sendTelegramPhoto(params: {
  chatId: string;
  messageThreadId?: number;
  pngBuffer: Buffer;
  caption: string;
  replyMarkup?: Record<string, unknown>;
}): Promise<number | null> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return null;
  }

  const form = new FormData();
  form.append("chat_id", params.chatId);
  if (params.messageThreadId && params.messageThreadId > 0) {
    form.append("message_thread_id", String(params.messageThreadId));
  }
  form.append("parse_mode", "HTML");
  form.append("caption", params.caption);
  if (params.replyMarkup) {
    form.append("reply_markup", JSON.stringify(params.replyMarkup));
  }
  const blob = new Blob([new Uint8Array(params.pngBuffer)], {
    type: "image/png",
  });
  form.append("photo", blob, "board.png");

  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const res = await fetch(url, {
    method: "POST",
    body: form,
  });
  const data = (await res.json()) as TelegramApiResponse<{
    message_id: number;
  }>;
  if (!data.ok) {
    console.error(
      `[TelegramBot] sendPhoto failed for chat ${params.chatId}:`,
      data.description
    );
    return null;
  }
  return data.result?.message_id ?? null;
}

export const telegramBotService = {
  /**
   * Selects a fresh puzzle for the club, renders board.png, posts to the club's topic thread,
   * and saves the challenge record in `tele_app.club_challenges`.
   */
  async publishChallengeToClub(
    chatId: string,
    override?: {
      discipline?: ChallengeDiscipline;
      difficulty?: ChallengeDifficulty;
      focusGroup?: string;
      focusKey?: string;
      objective?: string;
      puzzleId?: string;
    }
  ) {
    const [club] = await db
      .select()
      .from(clubs)
      .where(eq(clubs.chatId, chatId))
      .limit(1);

    if (!club) {
      throw new Error(`[TelegramBot] Club ${chatId} not found`);
    }
    if (club.status === "blocked") {
      throw new Error(`[TelegramBot] Club ${chatId} is blocked`);
    }

    // Resolve slot from weeklySchedule when override is not explicitly passed,
    // so discipline + difficulty + focus_group + focus_key + objective always stay synchronized.
    const schedule = normalizeWeeklySchedule(club.weeklySchedule);
    const zoned = getClubZonedTime(new Date(), club.timezone);
    const todaySlots = schedule[zoned.day]?.enabled
      ? schedule[zoned.day].slots
      : [];
    const activeHourSlot = todaySlots.find(
      (s) => zoned.hour >= s.from_hour && zoned.hour < s.to_hour
    );
    const allEnabledSlots: ClubScheduleSlot[] = [];
    for (const day of ALL_DAYS_OF_WEEK) {
      if (schedule[day].enabled) {
        allEnabledSlots.push(...schedule[day].slots);
      }
    }
    const fallbackSlot =
      activeHourSlot ??
      todaySlots[0] ??
      (allEnabledSlots.length > 0
        ? allEnabledSlots[Math.floor(Math.random() * allEnabledSlots.length)]
        : undefined);

    const chosenDiscipline: ChallengeDiscipline =
      override?.discipline ?? fallbackSlot?.discipline ?? "tactics";

    const chosenDifficulty: ChallengeDifficulty =
      override?.difficulty ?? fallbackSlot?.difficulty ?? "Novice";

    const chosenFocusGroup =
      override?.focusGroup ?? fallbackSlot?.focus_group ?? "all";
    const chosenFocusKey =
      override?.focusKey ?? fallbackSlot?.focus_key ?? "all";
    const chosenObjective =
      override?.objective ?? fallbackSlot?.objective ?? "all";

    // Get already published puzzle IDs in this club for this discipline
    const previousRows = await db
      .select({ puzzleId: clubChallenges.puzzleId })
      .from(clubChallenges)
      .where(
        and(
          eq(clubChallenges.chatId, chatId),
          eq(clubChallenges.discipline, chosenDiscipline)
        )
      );
    const excludeIds = previousRows.map((r) => r.puzzleId);

    const puzzle = override?.puzzleId
      ? await puzzleClientService.getPuzzleById(
          chosenDiscipline,
          override.puzzleId
        )
      : await puzzleClientService.selectClubPuzzle({
          discipline: chosenDiscipline,
          difficulty: chosenDifficulty,
          focusGroup: chosenFocusGroup,
          focusKey: chosenFocusKey,
          objective: chosenObjective,
          excludeIds,
        });

    const edition = String(previousRows.length + 1);
    const pngBuffer = renderBoardPng({
      fen: puzzle.puzzleFen,
      orientation: puzzle.userColor,
      lastMoveUci: puzzle.lastMoveUci,
    });

    const lang = normalizeLang(club.language);
    const caption = buildChallengeCaption(puzzle, lang);
    const solveStartParam = encodeChallengeStartParam(
      puzzle.discipline,
      puzzle.puzzleId,
      edition,
      chatId
    );
    const recordsStartParam = encodeClubLeaderboardStartParam(chatId);

    const solveBtnText =
      lang === "en"
        ? "🔥 SOLVE"
        : lang === "de"
          ? "🔥 LÖSEN"
          : "🔥 ЗАТАЩИТЬ";
    const tableBtnText =
      lang === "en"
        ? "🏆 TABLE"
        : lang === "de"
          ? "🏆 TABELLE"
          : "🏆 ТАБЛИЦА";

    const tgMessageId = await sendTelegramPhoto({
      chatId,
      messageThreadId: club.topicThreadId,
      pngBuffer,
      caption,
      replyMarkup: {
        inline_keyboard: [
          [
            {
              text: solveBtnText,
              url: `https://t.me/${env.BOT_USERNAME}?startapp=${solveStartParam}`,
            },
            {
              text: tableBtnText,
              url: `https://t.me/${env.BOT_USERNAME}?startapp=${recordsStartParam}`,
            },
          ],
        ],
      },
    });

    if (tgMessageId) {
      await callTelegramJson("pinChatMessage", {
        chat_id: chatId,
        message_id: tgMessageId,
        disable_notification: true,
      });
    }

    const [inserted] = await db
      .insert(clubChallenges)
      .values({
        chatId,
        discipline: puzzle.discipline,
        puzzleId: puzzle.puzzleId,
        edition,
        difficulty: puzzle.difficulty,
        botEngine: puzzle.botEngine,
        initialFen: puzzle.initialFen,
        puzzleFen: puzzle.puzzleFen,
        userColor: puzzle.userColor,
        firstMove: puzzle.firstMove,
        strategy: puzzle.strategy,
        objective: puzzle.objective,
        tacticalSolution: puzzle.tacticalSolution,
        domain: puzzle.domain,
        category: puzzle.category,
        tgMessageId,
      })
      .onConflictDoUpdate({
        target: [
          clubChallenges.chatId,
          clubChallenges.discipline,
          clubChallenges.puzzleId,
          clubChallenges.edition,
        ],
        set: {
          tgMessageId,
          publishedAt: new Date(),
        },
      })
      .returning();

    await db
      .update(clubs)
      .set({
        lastPublishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(clubs.chatId, chatId));

    return inserted;
  },

  /**
   * Sends the reply notification to the club's topic thread when a player solves a challenge:
   * "{{username}} 🤝\nПопыток - {{attempts}}\nСекунд - {{seconds}}" + inline button ТАБЛИЦА
   */
  async notifyChallengeSolved(params: {
    chatId: string;
    discipline: ChallengeDiscipline;
    puzzleId: string;
    edition: string;
    username: string;
    attempts: number;
    timeMs: number;
  }): Promise<void> {
    if (!env.TELEGRAM_BOT_TOKEN) return;

    const [club] = await db
      .select()
      .from(clubs)
      .where(eq(clubs.chatId, params.chatId))
      .limit(1);

    if (!club || club.status === "blocked") return;

    const [challenge] = await db
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
      .orderBy(desc(clubChallenges.publishedAt))
      .limit(1);

    const seconds = Math.round((params.timeMs / 1000) * 10) / 10;
    const lang = normalizeLang(club.language);
    const text =
      lang === "en"
        ? `${params.username} 🤝\nAttempts - ${params.attempts}\nSeconds - ${seconds}`
        : lang === "de"
          ? `${params.username} 🤝\nVersuche - ${params.attempts}\nSekunden - ${seconds}`
          : `${params.username} 🤝\nПопыток - ${params.attempts}\nСекунд - ${seconds}`;

    const recordsStartParam = encodeClubLeaderboardStartParam(params.chatId);
    const tableBtnText =
      lang === "en"
        ? "🏆 TABLE"
        : lang === "de"
          ? "🏆 TABELLE"
          : "🏆 ТАБЛИЦА";

    const payload: Record<string, unknown> = {
      chat_id: params.chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: tableBtnText,
              url: `https://t.me/${env.BOT_USERNAME}?startapp=${recordsStartParam}`,
            },
          ],
        ],
      },
    };

    if (club.topicThreadId > 0) {
      payload.message_thread_id = club.topicThreadId;
    }
    if (challenge?.tgMessageId) {
      payload.reply_parameters = {
        message_id: challenge.tgMessageId,
      };
    }

    await callTelegramJson("sendMessage", payload);
  },

  /**
   * Publishes a periodic Top-10 Club Standings summary to the club's topic thread
   * and updates `clubs.lastLeaderboardAt`.
   */
  async publishClubLeaderboardToTopic(chatId: string): Promise<boolean> {
    if (!env.TELEGRAM_BOT_TOKEN) return false;

    const [club] = await db
      .select()
      .from(clubs)
      .where(eq(clubs.chatId, chatId))
      .limit(1);

    if (!club || club.status !== "active") return false;

    const rows = await db
      .select({
        attempt: challengeAttempts,
        user: users,
      })
      .from(challengeAttempts)
      .leftJoin(users, eq(challengeAttempts.telegramId, users.telegramId))
      .where(eq(challengeAttempts.chatId, chatId));

    const statsByUser = new Map<
      string,
      {
        displayName: string;
        points: number;
        solved: number;
        attempts: number;
        timeMs: number;
      }
    >();

    for (const r of rows) {
      const att = r.attempt;
      if (!att.solved) continue;
      const usr = r.user;
      const displayName = usr
        ? usr.username
          ? `@${usr.username}`
          : usr.firstName
        : att.username;

      let entry = statsByUser.get(att.telegramId);
      if (!entry) {
        entry = {
          displayName,
          points: 0,
          solved: 0,
          attempts: 0,
          timeMs: 0,
        };
        statsByUser.set(att.telegramId, entry);
      }

      entry.points += calculateAttemptPoints(att.solved, att.attempts);
      entry.solved += 1;
      entry.attempts += att.attempts;
      entry.timeMs += Number(att.solvedTimeMs ?? 0);
    }

    const sorted = Array.from(statsByUser.values()).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
      return a.attempts - b.attempts;
    });

    if (sorted.length === 0) {
      await db
        .update(clubs)
        .set({ lastLeaderboardAt: new Date(), updatedAt: new Date() })
        .where(eq(clubs.chatId, chatId));
      return false;
    }

    const top10 = sorted.slice(0, 10);
    const lang = normalizeLang(club.language);
    const lines = top10.map((item, idx) => {
      const medal =
        idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}.`;
      const pts = roundPoints(item.points);
      const sec = Math.round((item.timeMs / 1000) * 10) / 10;
      if (lang === "en") {
        return `${medal} <b>${item.displayName}</b> — <b>${pts} pts</b> (${item.solved} solved, ${sec}s)`;
      }
      if (lang === "de") {
        return `${medal} <b>${item.displayName}</b> — <b>${pts} Pkt.</b> (${item.solved} gelöst, ${sec}s)`;
      }
      return `${medal} <b>${item.displayName}</b> — <b>${pts} очк.</b> (решено: ${item.solved}, ${sec}с)`;
    });

    const text =
      lang === "en"
        ? `🏆 <b>${club.title} — Top Players</b>\n\n${lines.join("\n")}`
        : lang === "de"
          ? `🏆 <b>${club.title} — Top-Spieler</b>\n\n${lines.join("\n")}`
          : `🏆 <b>${club.title} — Лидеры клуба</b>\n\n${lines.join("\n")}`;

    const recordsStartParam = encodeClubLeaderboardStartParam(chatId);
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      parse_mode: "HTML",
      text,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                lang === "en"
                  ? "🏆 FULL LEADERBOARD"
                  : lang === "de"
                    ? "🏆 GESAMTE RANGLISTE"
                    : "🏆 ВСЯ ТАБЛИЦА",
              url: `https://t.me/${env.BOT_USERNAME}?startapp=${recordsStartParam}`,
            },
          ],
        ],
      },
    };
    if (club.topicThreadId > 0) {
      payload.message_thread_id = club.topicThreadId;
    }

    const res = await callTelegramJson("sendMessage", payload);
    await db
      .update(clubs)
      .set({ lastLeaderboardAt: new Date(), updatedAt: new Date() })
      .where(eq(clubs.chatId, chatId));

    return res.ok;
  },

  /**
   * Forces the bot to leave a chat (used when SuperAdmin blocks a club or when onboarding validation fails).
   */
  async leaveClubChat(chatId: string, reasonMessage?: string): Promise<void> {
    if (!env.TELEGRAM_BOT_TOKEN) return;
    if (reasonMessage) {
      await callTelegramJson("sendMessage", {
        chat_id: chatId,
        text: reasonMessage,
      });
    }
    await callTelegramJson("leaveChat", { chat_id: chatId });
  },

  /**
   * Broadcasts a promo campaign to all active clubs in their topic thread.
   */
  async broadcastPromoCampaign(promo: {
    textRu: string;
    textEn: string;
    buttonRu: string | null;
    buttonEn: string | null;
    targetUrl: string | null;
  }): Promise<number> {
    if (!env.TELEGRAM_BOT_TOKEN) return 0;

    const activeClubs = await db
      .select()
      .from(clubs)
      .where(eq(clubs.status, "active"));

    let sentCount = 0;
    for (const club of activeClubs) {
      const isEn = club.language === "en";
      const text = isEn ? promo.textEn : promo.textRu;
      const btnText = (isEn ? promo.buttonEn : promo.buttonRu) || "ExtraPawn";
      const payload: Record<string, unknown> = {
        chat_id: club.chatId,
        parse_mode: "HTML",
        text,
      };
      if (club.topicThreadId > 0) {
        payload.message_thread_id = club.topicThreadId;
      }
      if (promo.targetUrl) {
        payload.reply_markup = {
          inline_keyboard: [[{ text: btnText, url: promo.targetUrl }]],
        };
      }
      const res = await callTelegramJson("sendMessage", payload);
      if (res.ok) sentCount += 1;
    }

    return sentCount;
  },

  /**
   * Handles `my_chat_member` updates when a club owner adds @ExtraPawnTeleBot to a group.
   */
  async handleMyChatMemberUpdate(
    update: NonNullable<TelegramUpdate["my_chat_member"]>
  ): Promise<void> {
    const chatId = String(update.chat.id);
    const status = update.new_chat_member.status;

    if (status === "left" || status === "kicked") {
      await db
        .update(clubs)
        .set({ status: "bot_removed", updatedAt: new Date() })
        .where(eq(clubs.chatId, chatId));
      return;
    }

    if (status !== "administrator" && status !== "member") {
      return;
    }

    // Check if club is blocked by SuperAdmin
    const [existingClub] = await db
      .select()
      .from(clubs)
      .where(eq(clubs.chatId, chatId))
      .limit(1);

    if (existingClub?.status === "blocked") {
      await this.leaveClubChat(
        chatId,
        "⛔ Эта группа заблокирована администратором ExtraPawn. / This group is blocked by ExtraPawn Admin."
      );
      return;
    }

    const fromId = String(update.from.id);
    const isSuperadminOwner =
      fromId === env.SUPERADMIN_TELEGRAM_ID ||
      chatId === env.DEFAULT_CLUB_CHAT_ID;

    // 1. Must be a supergroup
    if (update.chat.type !== "supergroup") {
      await this.leaveClubChat(
        chatId,
        "⚠️ Для работы @ExtraPawnTeleBot необходима Супергруппа с включенными Темами (Topics) и минимум 30 участниками."
      );
      return;
    }

    // 2. Check member count >= 30 (unless SuperAdmin / Default Club)
    const countRes = await callTelegramJson<number>("getChatMemberCount", {
      chat_id: chatId,
    });
    const memberCount = countRes.result ?? 0;

    if (!isSuperadminOwner && memberCount < 30) {
      await this.leaveClubChat(
        chatId,
        `⚠️ Для подключения @ExtraPawnTeleBot в супергруппе должно быть минимум 30 участников (сейчас: ${memberCount}). Добавьте бота повторно, когда клуб вырастет!`
      );
      return;
    }

    // 3. Check inviter is creator or administrator
    const memberInfoRes = await callTelegramJson<{ status: string }>(
      "getChatMember",
      {
        chat_id: chatId,
        user_id: update.from.id,
      }
    );
    const inviterRole = memberInfoRes.result?.status || "";
    if (
      !isSuperadminOwner &&
      inviterRole !== "creator" &&
      inviterRole !== "administrator"
    ) {
      await this.leaveClubChat(
        chatId,
        "⚠️ Подключить @ExtraPawnTeleBot может только владелец или администратор супергруппы."
      );
      return;
    }

    // 3.5 Enforce max 2 clubs per non-superadmin user
    if (!isSuperadminOwner) {
      const ownedClubs = await db
        .select({ chatId: clubs.chatId })
        .from(clubs)
        .where(
          and(
            eq(clubs.ownerTelegramId, fromId),
            eq(clubs.isDefault, false),
            ne(clubs.status, "bot_removed"),
            ne(clubs.chatId, chatId)
          )
        );
      if (ownedClubs.length >= MAX_OWNED_CLUBS_PER_USER) {
        await this.leaveClubChat(
          chatId,
          `⚠️ Достигнут лимит: к одному аккаунту можно подключить не более ${MAX_OWNED_CLUBS_PER_USER} шахматных клубов в ExtraPawn. Отключите бота в одной из предыдущих групп, чтобы подключить новую.`
        );
        return;
      }
    }

    // 4. Create Forum Topic "ExtraPawnTeleBot" (or reuse existing / default thread)
    let topicThreadId =
      chatId === env.DEFAULT_CLUB_CHAT_ID
        ? env.DEFAULT_CLUB_THREAD_ID
        : existingClub?.topicThreadId || 0;

    if (!topicThreadId) {
      const topicRes = await callTelegramJson<{ message_thread_id: number }>(
        "createForumTopic",
        {
          chat_id: chatId,
          name: "ExtraPawnTeleBot",
        }
      );

      if (!topicRes.ok || !topicRes.result?.message_thread_id) {
        await this.leaveClubChat(
          chatId,
          "⚠️ Пожалуйста, включите «Темы» (Topics) в настройках вашей супергруппы и выдайте @ExtraPawnTeleBot право «Управление темами» (Manage Topics), затем добавьте бота снова."
        );
        return;
      }

      topicThreadId = topicRes.result.message_thread_id;
    }

    // 5. Upsert owner user & club
    await db
      .insert(users)
      .values({
        telegramId: fromId,
        username: update.from.username || null,
        firstName: update.from.first_name || "Admin",
        lastName: update.from.last_name || null,
        languageCode: update.from.language_code?.startsWith("en") ? "en" : "ru",
        isSuperadmin: fromId === env.SUPERADMIN_TELEGRAM_ID,
      })
      .onConflictDoUpdate({
        target: users.telegramId,
        set: {
          username: update.from.username || null,
          firstName: update.from.first_name || "Admin",
          updatedAt: new Date(),
        },
      });

    await db
      .insert(clubs)
      .values({
        chatId,
        title: update.chat.title || "Chess Club",
        username: update.chat.username || null,
        inviteLink: update.chat.username
          ? `https://t.me/${update.chat.username}/${topicThreadId}`
          : null,
        ownerTelegramId: fromId,
        topicThreadId,
        memberCount,
        status: "active",
        isActive: true,
        autoPaused: false,
        autoPauseChallengeId: null,
        weeklySchedule: createDefaultWeeklySchedule(),
        isDefault: chatId === env.DEFAULT_CLUB_CHAT_ID,
      })
      .onConflictDoUpdate({
        target: clubs.chatId,
        set: {
          title: update.chat.title || "Chess Club",
          username: update.chat.username || null,
          topicThreadId,
          memberCount,
          status: "active",
          isActive: true,
          updatedAt: new Date(),
        },
      });

    await db
      .insert(clubAdmins)
      .values({
        chatId,
        telegramId: fromId,
        role: inviterRole === "creator" ? "owner" : "admin",
      })
      .onConflictDoUpdate({
        target: [clubAdmins.chatId, clubAdmins.telegramId],
        set: { role: inviterRole === "creator" ? "owner" : "admin" },
      });

    // 6. Send confirmation message in topic & publish initial challenge
    await callTelegramJson("sendMessage", {
      chat_id: chatId,
      message_thread_id: topicThreadId,
      parse_mode: "HTML",
      text: `♟ <b>ExtraPawn Challenge Bot подключен!</b>\nВсе шахматные челленджи и таблицы рекордов клуба будут публиковаться в этой теме.\nНастроить расписание, дисциплины и сложность можно в личном кабинете Mini App.`,
    });

    try {
      await this.publishChallengeToClub(chatId);
    } catch (err) {
      console.error(
        `[TelegramBot] Initial challenge publish failed for ${chatId}:`,
        err
      );
    }
  },

  /**
   * Returns the latest published challenge in `chatId` that nobody has solved or surrendered yet,
   * or `null` if every published challenge has at least one completed (`solved` or `surrendered`) attempt.
   */
  async findLatestUnresolvedChallenge(chatId: string) {
    const published = await db
      .select()
      .from(clubChallenges)
      .where(eq(clubChallenges.chatId, chatId))
      .orderBy(desc(clubChallenges.publishedAt));

    if (published.length === 0) return null;

    const completedAttempts = await db
      .select({
        discipline: challengeAttempts.discipline,
        puzzleId: challengeAttempts.puzzleId,
        edition: challengeAttempts.edition,
      })
      .from(challengeAttempts)
      .where(
        and(
          eq(challengeAttempts.chatId, chatId),
          or(
            eq(challengeAttempts.status, "solved"),
            eq(challengeAttempts.status, "surrendered")
          )
        )
      );

    const resolvedKeys = new Set(
      completedAttempts.map((a) => `${a.discipline}:${a.puzzleId}:${a.edition}`)
    );

    const unresolved = published.find(
      (c) => !resolvedKeys.has(`${c.discipline}:${c.puzzleId}:${c.edition}`)
    );

    return unresolved ?? null;
  },

  /**
   * Clears `autoPaused` on the club once there are no unresolved challenges remaining.
   */
  async checkAndResumeAutoPause(chatId: string): Promise<void> {
    const unresolved = await this.findLatestUnresolvedChallenge(chatId);
    if (!unresolved) {
      await db
        .update(clubs)
        .set({
          autoPaused: false,
          autoPauseChallengeId: null,
          updatedAt: new Date(),
        })
        .where(and(eq(clubs.chatId, chatId), eq(clubs.autoPaused, true)));
    }
  },
};

const WEEKDAY_MAP: Record<string, DayOfWeekKey> = {
  mon: "mon",
  tue: "tue",
  wed: "wed",
  thu: "thu",
  fri: "fri",
  sat: "sat",
  sun: "sun",
};

function getClubZonedTime(
  now: Date,
  timezone: string
): { day: DayOfWeekKey; hour: number; minute: number } {
  const formatForZone = (tz: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatForZone(timezone || "Europe/Berlin");
  } catch {
    parts = formatForZone("Europe/Berlin");
  }

  const weekdayStr = (
    parts.find((p) => p.type === "weekday")?.value ?? "mon"
  ).toLowerCase();
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minuteStr = parts.find((p) => p.type === "minute")?.value ?? "0";

  const day = WEEKDAY_MAP[weekdayStr.slice(0, 3)] ?? "mon";
  const hour = Number.parseInt(hourStr, 10) % 24;
  const minute = Number.parseInt(minuteStr, 10) % 60;

  return {
    day,
    hour: Number.isNaN(hour) ? 0 : hour,
    minute: Number.isNaN(minute) ? 0 : minute,
  };
}

let pollingActive = false;
let lastUpdateOffset = 0;

async function pollTelegramUpdatesOnce(): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    const res = await callTelegramJson<TelegramUpdate[]>("getUpdates", {
      offset: lastUpdateOffset,
      timeout: 15,
      allowed_updates: ["message", "my_chat_member"],
    });
    if (!res.ok || !res.result) return;

    for (const upd of res.result) {
      lastUpdateOffset = Math.max(lastUpdateOffset, upd.update_id + 1);
      if (upd.my_chat_member) {
        await telegramBotService.handleMyChatMemberUpdate(upd.my_chat_member);
      } else if (
        upd.message?.chat.type === "private" &&
        upd.message.text?.startsWith("/start")
      ) {
        await callTelegramJson("sendMessage", {
          chat_id: String(upd.message.chat.id),
          parse_mode: "HTML",
          text: `♟ <b>Добро пожаловать в ExtraPawn Challenges!</b>\nРешайте шахматные челленджи в клубах или подключите бота к своей супергруппе.`,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🚀 Открыть Mini App",
                  url: `https://t.me/${env.BOT_USERNAME}?startapp=cabinet`,
                },
              ],
            ],
          },
        });
      }
    }
  } catch (err) {
    console.error("[TelegramBot] Polling error:", err);
  }
}

async function notifyAutoPauseReplyOnce(
  club: typeof clubs.$inferSelect,
  unresolvedChallenge: typeof clubChallenges.$inferSelect
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;

  const lang = normalizeLang(club.language);
  const text =
    lang === "en"
      ? [
          `⏸ <b>Auto-Paused</b>`,
          `This challenge has not been solved (or surrendered) by anyone yet. Scheduled challenges are paused so we don't spam the chat.`,
          `Solve or surrender the active challenge to automatically resume the schedule!`,
        ].join("\n")
      : lang === "de"
        ? [
            `⏸ <b>Auto-Pause</b>`,
            `Diese Challenge wurde noch von niemandem gelöst (oder aufgegeben). Geplante Challenges sind pausiert, um den Chat nicht zu überfluten.`,
            `Sobald jemand die aktive Challenge löst oder aufgibt, läuft der Zeitplan automatisch weiter!`,
          ].join("\n")
        : [
            `⏸ <b>Бот встал на авто-паузу</b>`,
            `Этот челлендж пока никто не решил (и не сдался). Автоматическая публикация приостановлена, чтобы не спамить в чате.`,
            `Как только кто-то затащит челлендж или сдастся — расписание продолжится автоматически!`,
          ].join("\n");

  const solveStartParam = encodeChallengeStartParam(
    unresolvedChallenge.discipline as ChallengeDiscipline,
    unresolvedChallenge.puzzleId,
    unresolvedChallenge.edition,
    club.chatId
  );

  const payload: Record<string, unknown> = {
    chat_id: club.chatId,
    parse_mode: "HTML",
    text,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text:
              lang === "en"
                ? "🔥 SOLVE ACTIVE"
                : lang === "de"
                  ? "🔥 AKTIVE CHALLENGE LÖSEN"
                  : "🔥 ЗАТАЩИТЬ ЧЕЛЛЕНДЖ",
            url: `https://t.me/${env.BOT_USERNAME}?startapp=${solveStartParam}`,
          },
        ],
      ],
    },
  };

  if (club.topicThreadId > 0) {
    payload.message_thread_id = club.topicThreadId;
  }
  if (unresolvedChallenge.tgMessageId) {
    payload.reply_parameters = {
      message_id: unresolvedChallenge.tgMessageId,
    };
  }

  await callTelegramJson("sendMessage", payload);
}

async function runScheduledClubsTick(): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    const activeClubs = await db
      .select()
      .from(clubs)
      .where(and(eq(clubs.status, "active"), eq(clubs.isActive, true)));

    const now = new Date();
    for (const club of activeClubs) {
      // Recover missed initial challenge if a connected club has never published yet
      if (!club.isDefault && !club.lastPublishedAt && club.topicThreadId > 0) {
        try {
          await telegramBotService.publishChallengeToClub(club.chatId);
        } catch (err) {
          console.error(
            `[TelegramBot] Initial challenge recovery failed for club ${club.chatId}:`,
            err
          );
        }
        continue;
      }

      const schedule = normalizeWeeklySchedule(club.weeklySchedule);
      const zoned = getClubZonedTime(now, club.timezone);
      const dayConfig = schedule[zoned.day];
      if (!dayConfig.enabled || dayConfig.slots.length === 0) {
        continue;
      }

      const matchingSlot = dayConfig.slots.find((slot) => {
        if (zoned.hour < slot.from_hour || zoned.hour >= slot.to_hour) {
          return false;
        }
        const minutesSinceStart =
          (zoned.hour - slot.from_hour) * 60 + zoned.minute;
        return minutesSinceStart % slot.interval_minutes === 0;
      });

      if (!matchingSlot) continue;

      if (club.lastPublishedAt) {
        const elapsedMs =
          now.getTime() - new Date(club.lastPublishedAt).getTime();
        const minCooldownMs =
          Math.max(8, matchingSlot.interval_minutes - 2) * 60 * 1000;
        if (elapsedMs < minCooldownMs) {
          continue;
        }
      }

      // Smart Auto-Pause: check if there is an unresolved active challenge in this club
      const unresolved = await telegramBotService.findLatestUnresolvedChallenge(
        club.chatId
      );
      if (unresolved) {
        if (
          !club.autoPaused &&
          club.autoPauseChallengeId !== unresolved.id
        ) {
          await db
            .update(clubs)
            .set({
              autoPaused: true,
              autoPauseChallengeId: unresolved.id,
              updatedAt: new Date(),
            })
            .where(eq(clubs.chatId, club.chatId));

          try {
            await notifyAutoPauseReplyOnce(club, unresolved);
          } catch (err) {
            console.error(
              `[TelegramBot] Auto-pause notification failed for club ${club.chatId}:`,
              err
            );
          }
        }
        continue;
      }

      if (club.autoPaused) {
        await db
          .update(clubs)
          .set({
            autoPaused: false,
            autoPauseChallengeId: null,
            updatedAt: new Date(),
          })
          .where(eq(clubs.chatId, club.chatId));
      }

      try {
        await telegramBotService.publishChallengeToClub(club.chatId, {
          discipline: matchingSlot.discipline,
          difficulty: matchingSlot.difficulty,
          focusGroup: matchingSlot.focus_group,
          focusKey: matchingSlot.focus_key,
          objective: matchingSlot.objective,
        });
      } catch (err) {
        console.error(
          `[TelegramBot] Scheduled publish failed for club ${club.chatId}:`,
          err
        );
      }

      if (club.leaderboardCronDays > 0) {
        const cronIntervalMs = club.leaderboardCronDays * 24 * 60 * 60 * 1000;
        const shouldPostLeaderboard =
          !club.lastLeaderboardAt ||
          now.getTime() - new Date(club.lastLeaderboardAt).getTime() >=
            cronIntervalMs;
        if (shouldPostLeaderboard) {
          try {
            await telegramBotService.publishClubLeaderboardToTopic(club.chatId);
          } catch (err) {
            console.error(
              `[TelegramBot] Scheduled leaderboard post failed for club ${club.chatId}:`,
              err
            );
          }
        }
      }
    }
  } catch (err) {
    console.error("[TelegramBot] Scheduler tick error:", err);
  }
}

export function startTelegramBotBackgroundLoops(): void {
  if (!env.TELEGRAM_BOT_TOKEN || pollingActive) return;
  pollingActive = true;

  const loop = async () => {
    while (pollingActive) {
      await pollTelegramUpdatesOnce();
      await new Promise((r) => setTimeout(r, 2000));
    }
  };
  void loop();

  setTimeout(() => {
    void runScheduledClubsTick();
  }, 3_000);

  setInterval(() => {
    void runScheduledClubsTick();
  }, 60_000);
}

