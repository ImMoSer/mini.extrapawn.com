import { computed, ref } from "vue";
import {
  formatFocusLabel,
  type AppLanguage,
  type ChallengeDifficulty,
  type ChallengeDiscipline,
} from "shared";

const currentLang = ref<AppLanguage>("ru");

const DICT = {
  ru: {
    nav_cabinet: "Кабинет",
    nav_clubs: "Клубы",
    nav_go: "GO",
    nav_about: "О нас",
    nav_records: "Рекорды",
    nav_settings: "Настройки",
    nav_superadmin: "BOSS",
    go_title: "GO • ЗАДАЧИ ДНЯ",
    go_subtitle: "Непройденные задачи за сегодня по всем вашим клубам",
    go_empty: "На сегодня все задачи решены! 🎉",
    go_solve_cta: "Решить →",
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
    clubs_title: "КЛУБЫ • ЗА 7 ДНЕЙ",
    clubs_subtitle: "Тактика / Теория / Практика / Добивание • Сумма очков игроков клуба",
    clubs_avg_label: "СРЕДНЕЕ",
    clubs_scoring_hint: "Начисление очков: 1-я попытка = 1.0 • 2-я = 0.5 • 3-я = 0.33 • 4-я = 0.25 (1 / попыток)",
    clubs_players_word: "игр.",
    clubs_wins_word: "побед",
    cabinet_my_stats: "МОЯ СТАТИСТИКА (ЗА 7 ДНЕЙ)",
    cabinet_clubs_title: "ШАХМАТНЫЕ КЛУБЫ",
    cabinet_add_bot_title: "ПОДКЛЮЧИТЬ БОТА В СВОЙ ЧАТ",
    cabinet_add_bot_desc:
      "Бот автоматически создаст отдельную тему «ExtraPawnTeleBot» в вашей супергруппе (от 30 участников) и будет публиковать шахматные челленджи и таблицу рекордов.",
    cabinet_terms_checkbox:
      "Я администратор супергруппы и согласен с правилами использования @ExtraPawnTeleBot (включая редкие партнерские анонсы в теме бота).",
    cabinet_add_bot_btn: "➕ Добавить бота в супергруппу",
    cabinet_open_records: "Рекорды",
    cabinet_open_settings: "Настройки",
    records_analyze_cta: "Анализ →",
    cabinet_tab_my_clubs: "⚙️ Мои клубы",
    cabinet_my_clubs_empty:
      "У вас пока нет собственных подключенных клубов. Подключите бота к своей супергруппе ниже!",
    cabinet_limit_reached:
      "Достигнут лимит: не более 2 клубов на одного пользователя.",
    records_tab_active: "🔥 Активные",
    records_tab_completed: "✅ За сегодня",
    records_badge_solved: "Затащил",
    records_badge_surrendered: "Сдался",
    records_social_solved: "Решили",
    records_social_best: "Лучшее",
    records_no_active: "На сегодня все задачи клуба решены! 🎉",
    records_no_completed: "Сегодня вы еще не завершили ни одной задачи.",
    challenge_next_active_btn: "🔥 Далее",
    challenge_remaining_label: "осталось",
    day_mon: "Пн",
    day_tue: "Вт",
    day_wed: "Ср",
    day_thu: "Чт",
    day_fri: "Пт",
    day_sat: "Сб",
    day_sun: "Вс",
    settings_bot_active: "Бот активен",
    settings_bot_paused: "Бот на паузе",
    settings_auto_paused_badge: "АВТО-ПАУЗА (есть нерешенный челлендж)",
    settings_day_active: "День активен",
    settings_day_off: "Выходной",
    settings_copy_all_week: "📋 Применить ко всей неделе (Пн–Вс)",
    settings_copy_weekdays: "📋 К будням (Пн–Пт)",
    settings_add_interval: "➕ Добавить интервал",
    settings_from: "С",
    settings_to: "До",
    settings_every: "Интервал",
    settings_min: "мин",
    challenge_your_turn_white: "Ваш ход (Белые)",
    challenge_your_turn_black: "Ваш ход (Черные)",
    challenge_bot_thinking: "Бот думает...",
    challenge_wrong_move: "Неверный ход! Попробуйте еще раз.",
    challenge_solved_banner: "Челлендж решен! Результат отправлен в чат клуба.",
    challenge_surrendered_banner: "Вы сдались. Доступен анализ и просмотр чужих решений.",
    challenge_goal_tactics: "Найдите лучшее продолжение",
    challenge_goal_win: "Победите бота",
    challenge_goal_draw: "Удержите ничью",
    challenge_surrender_btn: "Сдаться",
    challenge_reset_btn: "Сначала",
    challenge_wasm_btn: "Stockfish",
    challenge_coach_btn: "Coach",
    challenge_leaderboard_title: "УЧАСТНИКИ ЧЕЛЛЕНДЖА",
    challenge_replay_moves: "▶ Ходы",
    challenge_replay_active: "Просмотр партии:",
    challenge_exit_replay: "Вернуться к своей доске",
    records_club_title: "РЕКОРДЫ ЗА 7 ДНЕЙ",
    records_recent_challenges: "ЗАДАЧИ СЕГОДНЯ",
    settings_title: "НАСТРОЙКИ БОТА В КЛУБЕ",
    settings_step_1: "1. ДИСЦИПЛИНЫ ЧЕЛЛЕНДЖЕЙ",
    settings_step_2: "2. СЛОЖНОСТЬ ЗАДАЧ (БОТ-СПАРРИНГ)",
    settings_step_3: "3. ФОКУС РАЗМИНКИ",
    settings_step_4: "4. РАСПИСАНИЕ ПУБЛИКАЦИЙ И ЯЗЫК",
    settings_save_btn: "Сохранить настройки клуба",
    settings_save_active_btn: "💾 Сохранить",
    settings_saved_passive_btn: "✓ Сохранено",
    settings_publish_now_btn: "🚀 Опубликовать челлендж сейчас",
    settings_saved_ok: "Настройки сохранены!",
    settings_slot_discipline: "Дисциплина (одна на интервал)",
    settings_slot_difficulty: "Сложность",
    settings_slot_focus: "Тема / Фокус",
    settings_bot_language: "Язык постов бота в Telegram",
    settings_club_timezone: "Часовой пояс клуба",
    settings_club_timezone_hint:
      "Расписание публикаций работает по часовому поясу клуба (по умолчанию Europe/Berlin), независимо от того, где находятся модераторы.",
    settings_blocked_title: "Ваш клуб временно заблокирован",
    settings_blocked_desc:
      "Обратитесь к разработчику @ProfessorMozer для разблокировки клуба:",
    settings_disconnect_zone_title: "ОТКЛЮЧЕНИЕ БОТА И УДАЛЕНИЕ ДАННЫХ",
    settings_disconnect_zone_desc:
      "Бот покинет вашу супергруппу, а вся история челленджей, попыток и настроек клуба будет безвозвратно удалена из базы данных.",
    settings_disconnect_btn: "🗑 Отключить бота и удалить данные клуба",
    settings_disconnect_confirm:
      "Вы уверены? Бот выйдет из чата, и все данные клуба будут полностью удалены из базы данных.",
    clubs_rule_1:
      "Группа должна быть Супергруппой (от 30 участников) с включенными Темами (Topics) — бот создаст свою тему «ExtraPawnTeleBot».",
    clubs_rule_2:
      "В теме бота публикуются шахматные челленджи, рекорды клуба и редкие анонсы проекта ExtraPawn.",
    clubs_rule_3:
      "Вы в любой момент можете поставить бота на паузу или полностью удалить все данные клуба из нашей базы одной кнопкой в настройках.",
    clubs_terms_prefix:
      "Я администратор супергруппы, прочитал(а) и согласен(на) с",
    clubs_terms_link: "Условиями использования",
    clubs_terms_mid: "и",
    clubs_privacy_link: "Политикой конфиденциальности",
    clubs_terms_suffix: "@ExtraPawnTeleBot.",
    consent_title: "Добро пожаловать в ExtraPawn!",
    consent_subtitle:
      "Перед началом ознакомьтесь с краткими правилами нашего шахматного сообщества:",
    consent_p1_title: "1. Бесплатно и добровольно («Как есть»)",
    consent_p1_text:
      "Приложение полностью бесплатное. Мы не берем плату за функции и не несем ответственности за сбои серверов или работу самого мессенджера Telegram.",
    consent_p2_title: "2. Какие данные хранятся",
    consent_p2_text:
      "Мы сохраняем только ваш публичный профиль Telegram (ID, имя, @username) и историю решения шахматных челленджей для подсчета клубного рейтинга.",
    consent_p3_title: "3. Управление данными",
    consent_p3_text:
      "Вы используете приложение добровольно в среде Telegram и можете в любой момент запросить полное удаление своих данных.",
    consent_check_prefix: "Я прочитал(а) и принимаю",
    consent_terms_link: "Условия использования",
    consent_check_mid: "и",
    consent_privacy_link: "Политику конфиденциальности",
    consent_check_suffix: "",
    consent_imprint_link: "Impressum",
    consent_continue_btn: "Продолжить",
    about_title: "О ПРОЕКТЕ EXTRAPAWN CHALLENGES",
    about_subtitle:
      "Межклубный шахматный чемпионат в Telegram и 100% бесплатная тренировочная экосистема",
    about_sec1_title: "♟ Как устроен чемпионат клубов",
    about_sec1_p1:
      "ExtraPawn объединяет шахматные супергруппы в едином 7-дневном зачете по 4 дисциплинам: Тактика, Теория эндшпиля, Практический эндшпиль и Добивание (Finish Him).",
    about_sec1_p2:
      "Формула честного начисления очков за каждый решенный челлендж: 1 / попытки (с 1-й попытки = 1.0 очка, со 2-й = 0.5, с 3-й = 0.33). После решения или сдачи открывается встроенный движок Stockfish, тренер Coach и просмотр партий одноклубников.",
    about_web_cta: "🌐 Открыть платформу ExtraPawn.com ↗",
    about_sec2_title: "🛡 Правила и данные простым языком",
    about_sec2_p1:
      "• 100% Бесплатно («Как есть»): все функции доступны без платных подписок. Разработчик не несет ответственности за перебои серверов или инфраструктуру Telegram.",
    about_sec2_p2:
      "• Минимум данных (Privacy by Design): хранятся только публичные метаданные профиля Telegram (ID, имя, @username) и попытки решения задач.",
    about_sec2_p3:
      "• Удаление в 1 клик: администратор любого клуба может в любой момент отключить бота и безвозвратно удалить все данные клуба в настройках. Личную статистику можно удалить по запросу.",
    about_sec3_title: "⚡ Лицензии и благодарности (GPLv3)",
    about_sec3_p1:
      "Этот проект лицензирован под GNU General Public License v3.0, что способствует прозрачности и росту сообщества. В соответствии с GPLv3 наш исходный код полностью открыт и доступен для блага мирового шахматного сообщества.",
    about_sec3_sf_title: "Stockfish 19",
    about_sec3_sf_desc:
      "Анализ и поиск истины обеспечиваются Stockfish — сильнейшим в мире шахматным движком с открытым исходным кодом (GNU GPLv3).",
    about_sec3_mozero_title: "Система спарринга MOZERO и нейросетевой хаб (наша разработка)",
    about_sec3_mozero_desc:
      "Реалистичный спарринг во всех дисциплинах и уровнях сложности обеспечивается нашей собственной гибридной системой MOZERO на базе движка lc0_32_1, весов Elite-Leela-v2-128x10x8h-1704000.pb.gz и специализированной Python-обвязки с эндшпильными базами Syzygy & Gaviota. Особая благодарность автору репозитория CallOn84/LeelaNets за публикацию весов нейросети.",
    about_sec3_lczero_title: "Leela Chess Zero (LCZero)",
    about_sec3_lczero_desc:
      "Наш нейросетевой слой работает на LCZero — новаторском движке, который открыл доступ к ИИ-шахматам широким массам. Уважение сообществу LCZero.",
    about_sec3_lichess_title: "Chessground, Chessops & Lichess Open Database",
    about_sec3_lichess_desc:
      "Отрисовка доски и шахматная логика выполняются сверхбыстрым движком Chessground & Chessops на базе открытых датасетов Lichess. Спасибо Lichess за лучший рендерер доски в мире!",
    about_repo_mini_btn: "📦 GitHub: mini.extrapawn.com ↗",
    about_repo_main_btn: "📦 GitHub: extrapawn.com ↗",
    about_repo_leela_btn: "📦 CallOn84/LeelaNets ↗",
    about_sec4_title: "❤️ Поддержать проект",
    about_sec4_desc:
      "Платформа полностью бесплатна для всех игроков и клубов. Если вам нравится ExtraPawn, вы можете добровольно поддержать развитие проекта и оплату серверов:",
    about_donate_btn: "❤️ Поддержать проект (Ko-fi)",
    about_contact_btn: "💬 Связаться с разработчиком (@ProfessorMozer)",
    about_sec5_title: "⚖️ Официальные правовые документы",
    about_link_imprint: "Impressum / Выходные данные",
    about_link_privacy: "Datenschutz / Конфиденциальность",
    about_link_terms: "Nutzungsbedingungen / Условия (AGB)",
  },
  en: {
    nav_cabinet: "Cabinet",
    nav_clubs: "Clubs",
    nav_go: "GO",
    nav_about: "About",
    nav_records: "Records",
    nav_settings: "Settings",
    nav_superadmin: "BOSS",
    go_title: "GO • TODAY'S CHALLENGES",
    go_subtitle: "Today's unsolved challenges across your clubs",
    go_empty: "All today's challenges are solved! 🎉",
    go_solve_cta: "Solve →",
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
    clubs_title: "CLUBS • LAST 7 DAYS",
    clubs_subtitle: "Tactics / Theoretical / Practical / Finish Him • Total Club Points",
    clubs_avg_label: "AVERAGE",
    clubs_scoring_hint: "Scoring: 1st try = 1.0 • 2nd = 0.5 • 3rd = 0.33 • 4th = 0.25 (1 / attempts)",
    clubs_players_word: "players",
    clubs_wins_word: "wins",
    cabinet_my_stats: "MY STATS (7 DAYS)",
    cabinet_clubs_title: "CHESS CLUBS",
    cabinet_add_bot_title: "ADD BOT TO YOUR SUPERGROUP",
    cabinet_add_bot_desc:
      "The bot automatically creates a dedicated 'ExtraPawnTeleBot' topic in your supergroup (30+ members) and posts daily chess challenges & leaderboards.",
    cabinet_terms_checkbox:
      "I am an admin of the supergroup and agree to the @ExtraPawnTeleBot Terms of Use (including occasional partner announcements in the bot topic).",
    cabinet_add_bot_btn: "➕ Add Bot to Supergroup",
    cabinet_open_records: "Records",
    cabinet_open_settings: "Settings",
    records_analyze_cta: "Analyze →",
    cabinet_tab_my_clubs: "⚙️ My Clubs",
    cabinet_my_clubs_empty:
      "You haven't connected any clubs of your own yet. Add the bot to your supergroup below!",
    cabinet_limit_reached:
      "Limit reached: up to 2 clubs per user.",
    records_tab_active: "🔥 Active",
    records_tab_completed: "✅ Today",
    records_badge_solved: "Solved",
    records_badge_surrendered: "Surrendered",
    records_social_solved: "Solved",
    records_social_best: "Best",
    records_no_active: "All today's club challenges solved! 🎉",
    records_no_completed: "No challenges completed today in this club yet.",
    challenge_next_active_btn: "🔥 Next",
    challenge_remaining_label: "left",
    day_mon: "Mon",
    day_tue: "Tue",
    day_wed: "Wed",
    day_thu: "Thu",
    day_fri: "Fri",
    day_sat: "Sat",
    day_sun: "Sun",
    settings_bot_active: "Bot Active",
    settings_bot_paused: "Bot Paused",
    settings_auto_paused_badge: "AUTO-PAUSED (unresolved challenge)",
    settings_day_active: "Day Active",
    settings_day_off: "Day Off",
    settings_copy_all_week: "📋 Copy to All Week (Mon–Sun)",
    settings_copy_weekdays: "📋 Copy to Weekdays (Mon–Fri)",
    settings_add_interval: "➕ Add Interval",
    settings_from: "From",
    settings_to: "To",
    settings_every: "Every",
    settings_min: "min",
    challenge_your_turn_white: "Your turn (White)",
    challenge_your_turn_black: "Your turn (Black)",
    challenge_bot_thinking: "Bot is thinking...",
    challenge_wrong_move: "Wrong move! Try again.",
    challenge_solved_banner: "Challenge solved! Result posted to the club chat.",
    challenge_surrendered_banner: "Surrendered. Analysis and other players' moves are unlocked.",
    challenge_goal_tactics: "Find the best continuation",
    challenge_goal_win: "Win against the bot",
    challenge_goal_draw: "Hold a draw against the bot",
    challenge_surrender_btn: "Surrender",
    challenge_reset_btn: "Reset",
    challenge_wasm_btn: "Stockfish",
    challenge_coach_btn: "Coach",
    challenge_leaderboard_title: "CHALLENGE LEADERBOARD",
    challenge_replay_moves: "▶ Moves",
    challenge_replay_active: "Replaying moves of:",
    challenge_exit_replay: "Back to my board",
    records_club_title: "RECORDS (7 DAYS)",
    records_recent_challenges: "TODAY'S CHALLENGES",
    settings_title: "CLUB BOT SETTINGS",
    settings_step_1: "1. CHALLENGE DISCIPLINES",
    settings_step_2: "2. DIFFICULTY (SPARRING BOT)",
    settings_step_3: "3. WARMUP FOCUS",
    settings_step_4: "4. SCHEDULE & LANGUAGE",
    settings_save_btn: "Save Club Settings",
    settings_save_active_btn: "💾 Save",
    settings_saved_passive_btn: "✓ Saved",
    settings_publish_now_btn: "🚀 Publish Challenge Now",
    settings_saved_ok: "Settings saved!",
    settings_slot_discipline: "Discipline (one per interval)",
    settings_slot_difficulty: "Difficulty",
    settings_slot_focus: "Theme / Focus",
    settings_bot_language: "Bot Language in Telegram",
    settings_club_timezone: "Club Timezone",
    settings_club_timezone_hint:
      "Scheduled challenges run in the club's timezone (default Europe/Berlin), regardless of where individual moderators live.",
    settings_blocked_title: "Your club is temporarily blocked",
    settings_blocked_desc:
      "Please contact the developer @ProfessorMozer to unblock your club:",
    settings_disconnect_zone_title: "DISCONNECT BOT & DELETE CLUB DATA",
    settings_disconnect_zone_desc:
      "The bot will leave your supergroup and all club challenges, attempts, and settings will be permanently deleted from PostgreSQL.",
    settings_disconnect_btn: "🗑 Disconnect Bot & Delete Club Data",
    settings_disconnect_confirm:
      "Are you sure? The bot will leave the chat and all club data will be permanently deleted from the database.",
    clubs_rule_1:
      "The group must be a Supergroup (30+ members) with Topics enabled — the bot will create its own topic 'ExtraPawnTeleBot'.",
    clubs_rule_2:
      "Chess challenges, club leaderboards, and occasional ExtraPawn project announcements are posted in the bot topic.",
    clubs_rule_3:
      "You can pause the bot at any time or permanently delete all club data from our database with one click in settings.",
    clubs_terms_prefix:
      "I am an admin of the supergroup and have read and agree to the",
    clubs_terms_link: "Terms of Use",
    clubs_terms_mid: "and",
    clubs_privacy_link: "Privacy Policy",
    clubs_terms_suffix: "of @ExtraPawnTeleBot.",
    consent_title: "Welcome to ExtraPawn!",
    consent_subtitle:
      "Before starting, please review the brief rules of our chess community:",
    consent_p1_title: "1. Free & Voluntary (\"As Is\")",
    consent_p1_text:
      "The app is 100% free. We do not charge for features and assume no liability for server outages or the operation of the Telegram messenger itself.",
    consent_p2_title: "2. What Data Is Stored",
    consent_p2_text:
      "We only store your public Telegram profile (ID, first name, @username) and your chess challenge solving history to calculate club rankings.",
    consent_p3_title: "3. Data Control",
    consent_p3_text:
      "You use the app voluntarily within Telegram and can request the complete deletion of your data at any time.",
    consent_check_prefix: "I have read and accept the",
    consent_terms_link: "Terms of Use",
    consent_check_mid: "and",
    consent_privacy_link: "Privacy Policy",
    consent_check_suffix: "",
    consent_imprint_link: "Imprint",
    consent_continue_btn: "Continue",
    about_title: "ABOUT EXTRAPAWN CHALLENGES",
    about_subtitle:
      "Inter-club chess championship in Telegram & 100% free training ecosystem",
    about_sec1_title: "♟ How the Club Championship Works",
    about_sec1_p1:
      "ExtraPawn unites chess supergroups in a rolling 7-day championship across 4 disciplines: Tactics, Theoretical Endgame, Practical Endgame, and Finish Him.",
    about_sec1_p2:
      "Fair scoring formula for every solved challenge: 1 / attempts (1st try = 1.0 pt, 2nd = 0.5, 3rd = 0.33). After solving or surrendering, built-in Stockfish analysis, Coach hints, and clubmates' move replays are unlocked.",
    about_web_cta: "🌐 Open ExtraPawn.com Platform ↗",
    about_sec2_title: "🛡 Plain-Language Rules & Privacy",
    about_sec2_p1:
      "• 100% Free (\"As Is\"): all features are available without paid subscriptions. The developer assumes no liability for server downtime or Telegram infrastructure.",
    about_sec2_p2:
      "• Minimal Data (Privacy by Design): we only store public Telegram profile metadata (ID, name, @username) and puzzle attempt results.",
    about_sec2_p3:
      "• 1-Click Deletion: any club admin can disconnect the bot and permanently delete all club data in settings at any time. Personal stats can be deleted upon request.",
    about_sec3_title: "⚡ Licenses & Credits (GPLv3)",
    about_sec3_p1:
      "This project is licensed under the GNU General Public License v3.0, promoting transparency and community growth. In accordance with GPLv3, our source code is completely open and available for the benefit of the global chess community.",
    about_sec3_sf_title: "Stockfish 19",
    about_sec3_sf_desc:
      "Analysis and truth-seeking are powered by Stockfish, the world's strongest open-source chess engine (GNU GPLv3).",
    about_sec3_mozero_title: "MOZERO Sparring System & Neural Hub (Our In-House Engineering)",
    about_sec3_mozero_desc:
      "Realistic sparring across all disciplines and difficulty tiers is powered by our custom hybrid MOZERO system built on lc0_32_1, Elite-Leela-v2-128x10x8h-1704000.pb.gz weights, and a specialized Python wrapper with Syzygy & Gaviota endgame tablebases. Special thanks to CallOn84/LeelaNets for publishing the neural network weights.",
    about_sec3_lczero_title: "Leela Chess Zero (LCZero)",
    about_sec3_lczero_desc:
      "Our neural network layer runs on LCZero — the pioneering engine that brought AI chess to the wider community. Huge respect to the LCZero team.",
    about_sec3_lichess_title: "Chessground, Chessops & Lichess Open Database",
    about_sec3_lichess_desc:
      "Board rendering and move validation are powered by the ultra-fast Chessground & Chessops libraries along with the Lichess Open Database. Thank you Lichess for the best chessboard renderer in the world!",
    about_repo_mini_btn: "📦 GitHub: mini.extrapawn.com ↗",
    about_repo_main_btn: "📦 GitHub: extrapawn.com ↗",
    about_repo_leela_btn: "📦 CallOn84/LeelaNets ↗",
    about_sec4_title: "❤️ Support the Project",
    about_sec4_desc:
      "The platform is 100% free for all players and clubs. If you enjoy ExtraPawn, you can voluntarily support the project's development and server costs:",
    about_donate_btn: "❤️ Support the Project (Ko-fi)",
    about_contact_btn: "💬 Contact Developer (@ProfessorMozer)",
    about_sec5_title: "⚖️ Official Legal Documents",
    about_link_imprint: "Imprint / Impressum",
    about_link_privacy: "Privacy Policy / Datenschutz",
    about_link_terms: "Terms of Use / AGB",
  },
  de: {
    nav_cabinet: "Profil",
    nav_clubs: "Klubs",
    nav_go: "GO",
    nav_about: "Info",
    nav_records: "Rekorde",
    nav_settings: "Einstellungen",
    nav_superadmin: "BOSS",
    go_title: "GO • HEUTE",
    go_subtitle: "Heutige offene Challenges aus Ihren Klubs",
    go_empty: "Alle heutigen Challenges gelöst! 🎉",
    go_solve_cta: "Lösen →",
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
    clubs_title: "KLUBS • 7 TAGE",
    clubs_subtitle: "Taktik / Theorie / Praxis / Finish Him • Gesamtpunkte des Klubs",
    clubs_avg_label: "SCHNITT",
    clubs_scoring_hint: "Punkte: 1. Versuch = 1.0 • 2. = 0.5 • 3. = 0.33 • 4. = 0.25 (1 / Versuche)",
    clubs_players_word: "Spieler",
    clubs_wins_word: "Siege",
    cabinet_my_stats: "MEINE STATISTIK (7 TAGE)",
    cabinet_clubs_title: "SCHACHKLUBS",
    cabinet_add_bot_title: "BOT ZUR SUPERGRUPPE HINZUFÜGEN",
    cabinet_add_bot_desc:
      "Der Bot erstellt automatisch das Thema 'ExtraPawnTeleBot' in Ihrer Supergruppe (ab 30 Mitgliedern) und veröffentlicht täglich Schach-Challenges & Ranglisten.",
    cabinet_terms_checkbox:
      "Ich bin Administrator der Supergruppe und stimme den Nutzungsbedingungen von @ExtraPawnTeleBot zu (inkl. seltener Partner-Hinweise im Bot-Thema).",
    cabinet_add_bot_btn: "➕ Bot zur Supergruppe hinzufügen",
    cabinet_open_records: "Rekorde",
    cabinet_open_settings: "Setup",
    records_analyze_cta: "Analyse →",
    cabinet_tab_my_clubs: "⚙️ Meine Klubs",
    cabinet_my_clubs_empty:
      "Sie haben noch keine eigenen Klubs verbunden. Fügen Sie den Bot unten Ihrer Supergruppe hinzu!",
    cabinet_limit_reached:
      "Limit erreicht: maximal 2 Klubs pro Benutzer.",
    records_tab_active: "🔥 Aktiv",
    records_tab_completed: "✅ Heute",
    records_badge_solved: "Geschafft",
    records_badge_surrendered: "Aufgegeben",
    records_social_solved: "Gelöst",
    records_social_best: "Bestzeit",
    records_no_active: "Alle heutigen Klub-Challenges gelöst! 🎉",
    records_no_completed: "Heute noch keine Challenges in diesem Klub erledigt.",
    challenge_next_active_btn: "🔥 Weiter",
    challenge_remaining_label: "übrig",
    day_mon: "Mo",
    day_tue: "Di",
    day_wed: "Mi",
    day_thu: "Do",
    day_fri: "Fr",
    day_sat: "Sa",
    day_sun: "So",
    settings_bot_active: "Bot aktiv",
    settings_bot_paused: "Bot pausiert",
    settings_auto_paused_badge: "AUTO-PAUSE (offene Challenge)",
    settings_day_active: "Tag aktiv",
    settings_day_off: "Ruhetag",
    settings_copy_all_week: "📋 Auf ganze Woche anwenden (Mo–So)",
    settings_copy_weekdays: "📋 Auf Werktage (Mo–Fr)",
    settings_add_interval: "➕ Intervall hinzufügen",
    settings_from: "Von",
    settings_to: "Bis",
    settings_every: "Intervall",
    settings_min: "Min",
    challenge_your_turn_white: "Sie sind am Zug (Weiß)",
    challenge_your_turn_black: "Sie sind am Zug (Schwarz)",
    challenge_bot_thinking: "Bot denkt nach...",
    challenge_wrong_move: "Falscher Zug! Versuchen Sie es erneut.",
    challenge_solved_banner: "Challenge gelöst! Ergebnis im Klub-Chat gepostet.",
    challenge_surrendered_banner: "Aufgegeben. Analyse und Züge anderer Spieler sind freigeschaltet.",
    challenge_goal_tactics: "Finden Sie die beste Fortsetzung",
    challenge_goal_win: "Gewinnen Sie gegen den Bot",
    challenge_goal_draw: "Halten Sie das Remis gegen den Bot",
    challenge_surrender_btn: "Aufgeben",
    challenge_reset_btn: "Reset",
    challenge_wasm_btn: "Stockfish",
    challenge_coach_btn: "Coach",
    challenge_leaderboard_title: "CHALLENGE-TEILNEHMER",
    challenge_replay_moves: "▶ Züge",
    challenge_replay_active: "Partie von:",
    challenge_exit_replay: "Zurück zum eigenen Brett",
    records_club_title: "REKORDE (7 TAGE)",
    records_recent_challenges: "HEUTIGE CHALLENGES",
    settings_title: "KLUB-BOT EINSTELLUNGEN",
    settings_step_1: "1. CHALLENGE-DISZIPLINEN",
    settings_step_2: "2. SCHWIERIGKEIT (SPARRING-BOT)",
    settings_step_3: "3. WARMUP-FOKUS",
    settings_step_4: "4. ZEITPLAN & SPRACHE",
    settings_save_btn: "Klub-Einstellungen speichern",
    settings_save_active_btn: "💾 Speichern",
    settings_saved_passive_btn: "✓ Gespeichert",
    settings_publish_now_btn: "🚀 Challenge jetzt veröffentlichen",
    settings_saved_ok: "Einstellungen gespeichert!",
    settings_slot_discipline: "Disziplin (eine pro Intervall)",
    settings_slot_difficulty: "Schwierigkeit",
    settings_slot_focus: "Thema / Fokus",
    settings_bot_language: "Sprache der Bot-Posts in Telegram",
    settings_club_timezone: "Zeitzone des Klubs",
    settings_club_timezone_hint:
      "Der Zeitplan läuft in der Zeitzone des Klubs (Standard Europe/Berlin), unabhängig vom Wohnort der Moderatoren.",
    settings_blocked_title: "Ihr Klub ist vorübergehend gesperrt",
    settings_blocked_desc:
      "Bitte wenden Sie sich an den Entwickler @ProfessorMozer, um Ihren Klub zu entsperren:",
    settings_disconnect_zone_title: "BOT TRENNEN & KLUBDATEN LÖSCHEN",
    settings_disconnect_zone_desc:
      "Der Bot verlässt Ihre Supergruppe und alle Challenges, Versuche und Einstellungen des Klubs werden unwiderruflich aus der Datenbank gelöscht.",
    settings_disconnect_btn: "🗑 Bot trennen & Klubdaten löschen",
    settings_disconnect_confirm:
      "Sind Sie sicher? Der Bot verlässt den Chat und alle Klubdaten werden vollständig aus der Datenbank gelöscht.",
    clubs_rule_1:
      "Die Gruppe muss eine Supergruppe (ab 30 Mitgliedern) mit aktivierten Themen (Topics) sein — der Bot erstellt sein eigenes Thema „ExtraPawnTeleBot“.",
    clubs_rule_2:
      "Im Bot-Thema werden Schach-Challenges, Klub-Rekorde und gelegentliche Ankündigungen des Projekts ExtraPawn veröffentlicht.",
    clubs_rule_3:
      "Sie können den Bot jederzeit pausieren oder alle Klubdaten mit einem Klick in den Einstellungen vollständig aus unserer Datenbank löschen.",
    clubs_terms_prefix:
      "Ich bin Administrator der Supergruppe, habe die",
    clubs_terms_link: "Nutzungsbedingungen",
    clubs_terms_mid: "und die",
    clubs_privacy_link: "Datenschutzerklärung",
    clubs_terms_suffix: "von @ExtraPawnTeleBot gelesen und stimme ihnen zu.",
    consent_title: "Willkommen bei ExtraPawn!",
    consent_subtitle:
      "Bitte bestätigen Sie kurz die Regeln unserer Schach-Community:",
    consent_p1_title: "1. Kostenlos & Freiwillig („Wie besehen“)",
    consent_p1_text:
      "Die App ist zu 100 % kostenlos. Wir erheben keine Gebühren für Funktionen und übernehmen keine Haftung für Serverausfälle oder den Betrieb des Messengers Telegram.",
    consent_p2_title: "2. Welche Daten gespeichert werden",
    consent_p2_text:
      "Wir speichern lediglich Ihr öffentliches Telegram-Profil (ID, Vorname, @username) und Ihre Challenge-Ergebnisse zur Berechnung der Klub-Rangliste.",
    consent_p3_title: "3. Kontrolle über Ihre Daten",
    consent_p3_text:
      "Sie nutzen die App freiwillig in Telegram und können jederzeit die vollständige Löschung Ihrer Daten anfordern.",
    consent_check_prefix: "Ich habe die",
    consent_terms_link: "Nutzungsbedingungen",
    consent_check_mid: "und die",
    consent_privacy_link: "Datenschutzerklärung",
    consent_check_suffix: "gelesen und akzeptiere sie",
    consent_imprint_link: "Impressum",
    consent_continue_btn: "Weiter",
    about_title: "ÜBER EXTRAPAWN CHALLENGES",
    about_subtitle:
      "Inter-Klub Schachmeisterschaft in Telegram & 100 % kostenloses Trainings-Ökosystem",
    about_sec1_title: "♟ Wie die Klub-Meisterschaft funktioniert",
    about_sec1_p1:
      "ExtraPawn verbindet Schach-Supergruppen in einer rollierenden 7-Tage-Wertung über 4 Disziplinen: Taktik, Endspieltheorie, Praktisches Endspiel und Finish Him.",
    about_sec1_p2:
      "Faire Punkteformel pro gelöster Challenge: 1 / Versuche (1. Versuch = 1.0 Pkt., 2. = 0.5, 3. = 0.33). Nach Lösung oder Aufgabe werden die integrierte Stockfish-Analyse, der Coach und die Züge der Klubmitglieder freigeschaltet.",
    about_web_cta: "🌐 Plattform ExtraPawn.com öffnen ↗",
    about_sec2_title: "🛡 Regeln & Datenschutz einfach erklärt",
    about_sec2_p1:
      "• 100 % Kostenlos („As Is“): Alle Funktionen sind ohne Bezahlung verfügbar. Der Entwickler haftet nicht für Serverausfälle oder die Telegram-Infrastruktur.",
    about_sec2_p2:
      "• Minimale Daten (Privacy by Design): Gespeichert werden nur öffentliche Telegram-Profildaten (ID, Name, @username) und Lösungsversuche.",
    about_sec2_p3:
      "• 1-Klick-Löschung: Klub-Admins können den Bot jederzeit trennen und alle Klubdaten in den Einstellungen unwiderruflich löschen. Persönliche Daten werden auf Anfrage gelöscht.",
    about_sec3_title: "⚡ Lizenzen & Danksagung (GPLv3)",
    about_sec3_p1:
      "Dieses Projekt ist unter der GNU General Public License v3.0 lizenziert, was Transparenz und das Wachstum der Community fördert. Gemäß GPLv3 ist unser Quellcode vollständig offen und zum Nutzen der weltweiten Schachgemeinschaft zugänglich.",
    about_sec3_sf_title: "Stockfish 19",
    about_sec3_sf_desc:
      "Analyse und Wahrheitssuche werden von Stockfish bereitgestellt, der weltweit stärksten Open-Source-Schach-Engine (GNU GPLv3).",
    about_sec3_mozero_title: "MOZERO Sparring-System & Neural Hub (Unsere Eigenentwicklung)",
    about_sec3_mozero_desc:
      "Realistisches Sparring in allen Disziplinen und Stufen wird durch unser eigenes hybrides MOZERO-System auf Basis von lc0_32_1, den Gewichten Elite-Leela-v2-128x10x8h-1704000.pb.gz und einer spezialisierten Python-Anbindung mit Syzygy- & Gaviota-Endspieldatenbanken ermöglicht. Besonderer Dank gilt CallOn84/LeelaNets für die Veröffentlichung der Netzgewichte.",
    about_sec3_lczero_title: "Leela Chess Zero (LCZero)",
    about_sec3_lczero_desc:
      "Unsere neuronale Schicht basiert auf LCZero — der bahnbrechenden Engine, die KI-Schach für alle zugänglich gemacht hat. Großer Respekt an die LCZero-Community.",
    about_sec3_lichess_title: "Chessground, Chessops & Lichess Open Database",
    about_sec3_lichess_desc:
      "Die Brettdarstellung und Zuglogik erfolgen über das ultraschnelle Chessground & Chessops sowie die Lichess Open Database. Danke an Lichess für den besten Schachbrett-Renderer der Welt!",
    about_repo_mini_btn: "📦 GitHub: mini.extrapawn.com ↗",
    about_repo_main_btn: "📦 GitHub: extrapawn.com ↗",
    about_repo_leela_btn: "📦 CallOn84/LeelaNets ↗",
    about_sec4_title: "❤️ Projekt unterstützen",
    about_sec4_desc:
      "Die Plattform ist für alle Spieler und Klubs komplett kostenlos. Wenn Ihnen ExtraPawn gefällt, können Sie die Weiterentwicklung und Serverkosten freiwillig unterstützen:",
    about_donate_btn: "❤️ Projekt unterstützen (Ko-fi)",
    about_contact_btn: "💬 Entwickler kontaktieren (@ProfessorMozer)",
    about_sec5_title: "⚖️ Offizielle Rechtsdokumente",
    about_link_imprint: "Impressum",
    about_link_privacy: "Datenschutzerklärung",
    about_link_terms: "Nutzungsbedingungen (AGB)",
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

  function focusTitle(
    d: ChallengeDiscipline,
    rawCategory: string | null | undefined
  ): string {
    return formatFocusLabel(d, rawCategory, lang.value);
  }

  return {
    lang,
    setLanguage,
    t,
    disciplineTitle,
    difficultyTitle,
    focusTitle,
  };
}

