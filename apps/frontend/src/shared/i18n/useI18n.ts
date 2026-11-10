import { computed, ref } from "vue";
import type { AppLanguage, ChallengeDifficulty, ChallengeDiscipline } from "shared";

const currentLang = ref<AppLanguage>("ru");

const DICT = {
  ru: {
    nav_cabinet: "Кабинет",
    nav_clubs: "Клубы",
    nav_records: "Рекорды",
    nav_settings: "Настройки",
    nav_superadmin: "СуперАдмин",
    disc_tactics: "ТАКТИКА",
    disc_theoretical_endgames: "ТЕОРИЯ ЭНДШПИЛЯ",
    disc_practical_chess: "ПРАКТИЧЕСКИЙ ЭНДШПИЛЬ",
    disc_finishhim: "ДОБИВАНИЕ (FINISH HIM)",
    diff_Novice: "Новичок",
    diff_Pro: "Профи",
    diff_Master: "Мастер",
    stats_attempts: "Попыток",
    stats_solved: "Успехов",
    stats_failed: "Провалов",
    stats_points: "Очков",
    clubs_title: "СОРЕВНОВАНИЕ КЛУБОВ (ЗА 30 ДНЕЙ)",
    clubs_subtitle: "Тактика / Теория / Практика / Добивание и среднее арифметическое",
    clubs_avg_label: "СРЕДНЕЕ",
    clubs_scoring_hint: "Начисление очков: 1-я попытка = 1.0 • 2-я = 0.5 • 3-я = 0.33 • 4-я = 0.25 (1 / попыток)",
    cabinet_my_stats: "МОЯ СТАТИСТИКА (ВСЕ СЛОЖНОСТИ)",
    cabinet_clubs_title: "ШАХМАТНЫЕ КЛУБЫ",
    cabinet_add_bot_title: "ПОДКЛЮЧИТЬ БОТА В СВОЙ ЧАТ",
    cabinet_add_bot_desc:
      "Бот автоматически создаст отдельную тему «ExtraPawnTeleBot» в вашей супергруппе (от 30 участников) и будет публиковать шахматные челленджи и таблицу рекордов.",
    cabinet_terms_checkbox:
      "Я администратор супергруппы и согласен с правилами использования @ExtraPawnTeleBot (включая редкие партнерские анонсы в теме бота).",
    cabinet_add_bot_btn: "➕ Добавить бота в супергруппу",
    cabinet_open_records: "Таблица рекордов",
    cabinet_open_settings: "Настроить бота",
    cabinet_join_default_club: "Вступить в родной клуб EXTRAPAWNCLUB",
    challenge_your_turn_white: "Ваш ход (Белые)",
    challenge_your_turn_black: "Ваш ход (Черные)",
    challenge_bot_thinking: "Бот думает...",
    challenge_wrong_move: "Неверный ход! Попробуйте еще раз.",
    challenge_solved_banner: "Челлендж решен! Результат отправлен в чат клуба.",
    challenge_surrendered_banner: "Вы сдались. Доступен анализ и просмотр чужих решений.",
    challenge_goal_tactics: "Найдите лучшее продолжение",
    challenge_goal_win: "Победите бота",
    challenge_goal_draw: "Удержите ничью",
    challenge_surrender_btn: "Сдаться / Анализ",
    challenge_wasm_btn: "Локальный Stockfish WASM",
    challenge_leaderboard_title: "УЧАСТНИКИ ЧЕЛЛЕНДЖА",
    challenge_replay_moves: "▶ Ходы",
    challenge_replay_active: "Просмотр партии:",
    challenge_exit_replay: "Вернуться к своей доске",
    records_club_title: "РЕКОРДЫ КЛУБА",
    records_recent_challenges: "ПОСЛЕДНИЕ ЧЕЛЛЕНДЖИ КЛУБА",
    settings_title: "НАСТРОЙКИ БОТА В КЛУБЕ",
    settings_step_1: "1. ДИСЦИПЛИНЫ ЧЕЛЛЕНДЖЕЙ",
    settings_step_2: "2. СЛОЖНОСТЬ ЗАДАЧ (БОТ-СПАРРИНГ)",
    settings_step_3: "3. ФОКУС РАЗМИНКИ",
    settings_step_4: "4. РАСПИСАНИЕ ПУБЛИКАЦИЙ И ЯЗЫК",
    settings_save_btn: "Сохранить настройки клуба",
    settings_publish_now_btn: "🚀 Опубликовать челлендж сейчас",
    settings_saved_ok: "Настройки сохранены!",
  },
  en: {
    nav_cabinet: "Cabinet",
    nav_clubs: "Clubs",
    nav_records: "Records",
    nav_settings: "Settings",
    nav_superadmin: "SuperAdmin",
    disc_tactics: "TACTICS",
    disc_theoretical_endgames: "THEORETICAL ENDGAME",
    disc_practical_chess: "PRACTICAL ENDGAME",
    disc_finishhim: "FINISH HIM",
    diff_Novice: "Novice",
    diff_Pro: "Pro",
    diff_Master: "Master",
    stats_attempts: "Attempts",
    stats_solved: "Solved",
    stats_failed: "Failed",
    stats_points: "Points",
    clubs_title: "INTER-CLUB CHAMPIONSHIP (LAST 30 DAYS)",
    clubs_subtitle: "Tactics / Theoretical / Practical / Finish Him & Arithmetic Mean",
    clubs_avg_label: "AVERAGE",
    clubs_scoring_hint: "Scoring: 1st try = 1.0 • 2nd = 0.5 • 3rd = 0.33 • 4th = 0.25 (1 / attempts)",
    cabinet_my_stats: "MY STATS (ALL DIFFICULTIES)",
    cabinet_clubs_title: "CHESS CLUBS",
    cabinet_add_bot_title: "ADD BOT TO YOUR SUPERGROUP",
    cabinet_add_bot_desc:
      "The bot automatically creates a dedicated 'ExtraPawnTeleBot' topic in your supergroup (30+ members) and posts daily chess challenges & leaderboards.",
    cabinet_terms_checkbox:
      "I am an admin of the supergroup and agree to the @ExtraPawnTeleBot Terms of Use (including occasional partner announcements in the bot topic).",
    cabinet_add_bot_btn: "➕ Add Bot to Supergroup",
    cabinet_open_records: "Leaderboard",
    cabinet_open_settings: "Bot Settings",
    cabinet_join_default_club: "Open Native Club EXTRAPAWNCLUB",
    challenge_your_turn_white: "Your turn (White)",
    challenge_your_turn_black: "Your turn (Black)",
    challenge_bot_thinking: "Bot is thinking...",
    challenge_wrong_move: "Wrong move! Try again.",
    challenge_solved_banner: "Challenge solved! Result posted to the club chat.",
    challenge_surrendered_banner: "Surrendered. Analysis and other players' moves are unlocked.",
    challenge_goal_tactics: "Find the best continuation",
    challenge_goal_win: "Win against the bot",
    challenge_goal_draw: "Hold a draw against the bot",
    challenge_surrender_btn: "Surrender / Analyze",
    challenge_wasm_btn: "Local Stockfish WASM",
    challenge_leaderboard_title: "CHALLENGE LEADERBOARD",
    challenge_replay_moves: "▶ Moves",
    challenge_replay_active: "Replaying moves of:",
    challenge_exit_replay: "Back to my board",
    records_club_title: "CLUB LEADERBOARD",
    records_recent_challenges: "RECENT CLUB CHALLENGES",
    settings_title: "CLUB BOT SETTINGS",
    settings_step_1: "1. CHALLENGE DISCIPLINES",
    settings_step_2: "2. DIFFICULTY (SPARRING BOT)",
    settings_step_3: "3. WARMUP FOCUS",
    settings_step_4: "4. SCHEDULE & LANGUAGE",
    settings_save_btn: "Save Club Settings",
    settings_publish_now_btn: "🚀 Publish Challenge Now",
    settings_saved_ok: "Settings saved!",
  },
  de: {
    nav_cabinet: "Profil",
    nav_clubs: "Klubs",
    nav_records: "Rekorde",
    nav_settings: "Einstellungen",
    nav_superadmin: "SuperAdmin",
    disc_tactics: "TAKTIK",
    disc_theoretical_endgames: "ENDSPIELTHEORIE",
    disc_practical_chess: "PRAKTISCHES ENDSPIEL",
    disc_finishhim: "FINISH HIM",
    diff_Novice: "Einsteiger",
    diff_Pro: "Profi",
    diff_Master: "Meister",
    stats_attempts: "Versuche",
    stats_solved: "Gelöst",
    stats_failed: "Fehler",
    stats_points: "Punkte",
    clubs_title: "KLUB-MEISTERSCHAFT (LETZTE 30 TAGE)",
    clubs_subtitle: "Taktik / Theorie / Praxis / Finish Him & Durchschnitt",
    clubs_avg_label: "SCHNITT",
    clubs_scoring_hint: "Punkte: 1. Versuch = 1.0 • 2. = 0.5 • 3. = 0.33 • 4. = 0.25 (1 / Versuche)",
    cabinet_my_stats: "MEINE STATISTIK (ALLE STUFEN)",
    cabinet_clubs_title: "SCHACHKLUBS",
    cabinet_add_bot_title: "BOT ZUR SUPERGRUPPE HINZUFÜGEN",
    cabinet_add_bot_desc:
      "Der Bot erstellt automatisch das Thema 'ExtraPawnTeleBot' in Ihrer Supergruppe (ab 30 Mitgliedern) und veröffentlicht täglich Schach-Challenges & Ranglisten.",
    cabinet_terms_checkbox:
      "Ich bin Administrator der Supergruppe und stimme den Nutzungsbedingungen von @ExtraPawnTeleBot zu (inkl. seltener Partner-Hinweise im Bot-Thema).",
    cabinet_add_bot_btn: "➕ Bot zur Supergruppe hinzufügen",
    cabinet_open_records: "Rangliste",
    cabinet_open_settings: "Bot-Einstellungen",
    cabinet_join_default_club: "Stammklub EXTRAPAWNCLUB öffnen",
    challenge_your_turn_white: "Sie sind am Zug (Weiß)",
    challenge_your_turn_black: "Sie sind am Zug (Schwarz)",
    challenge_bot_thinking: "Bot denkt nach...",
    challenge_wrong_move: "Falscher Zug! Versuchen Sie es erneut.",
    challenge_solved_banner: "Challenge gelöst! Ergebnis im Klub-Chat gepostet.",
    challenge_surrendered_banner: "Aufgegeben. Analyse und Züge anderer Spieler sind freigeschaltet.",
    challenge_goal_tactics: "Finden Sie die beste Fortsetzung",
    challenge_goal_win: "Gewinnen Sie gegen den Bot",
    challenge_goal_draw: "Halten Sie das Remis gegen den Bot",
    challenge_surrender_btn: "Aufgeben / Analyse",
    challenge_wasm_btn: "Lokales Stockfish WASM",
    challenge_leaderboard_title: "CHALLENGE-TEILNEHMER",
    challenge_replay_moves: "▶ Züge",
    challenge_replay_active: "Partie von:",
    challenge_exit_replay: "Zurück zum eigenen Brett",
    records_club_title: "KLUB-RANGLISTE",
    records_recent_challenges: "AKTUELLE KLUB-CHALLENGES",
    settings_title: "KLUB-BOT EINSTELLUNGEN",
    settings_step_1: "1. CHALLENGE-DISZIPLINEN",
    settings_step_2: "2. SCHWIERIGKEIT (SPARRING-BOT)",
    settings_step_3: "3. WARMUP-FOKUS",
    settings_step_4: "4. ZEITPLAN & SPRACHE",
    settings_save_btn: "Klub-Einstellungen speichern",
    settings_publish_now_btn: "🚀 Challenge jetzt veröffentlichen",
    settings_saved_ok: "Einstellungen gespeichert!",
  },
} as const;

export type TranslationKey = keyof typeof DICT.ru;

export function useI18n() {
  const lang = computed<AppLanguage>(() =>
    currentLang.value === "en" || currentLang.value === "de"
      ? currentLang.value
      : "ru"
  );

  function setLanguage(next: AppLanguage) {
    currentLang.value =
      next === "en" || next === "de" ? next : "ru";
  }

  function t(key: TranslationKey): string {
    return DICT[lang.value][key] ?? DICT.ru[key];
  }

  function disciplineTitle(d: ChallengeDiscipline): string {
    return t(`disc_${d}` as TranslationKey);
  }

  function difficultyTitle(d: ChallengeDifficulty): string {
    return t(`diff_${d}` as TranslationKey);
  }

  return {
    lang,
    setLanguage,
    t,
    disciplineTitle,
    difficultyTitle,
  };
}

