import { ALL_DAYS_OF_WEEK, type WeeklyScheduleConfig } from "shared";

const CLUB_ROUTE_ERRORS = {
  ru: {
    notFound: "Клуб не найден",
    forbiddenManager:
      "Доступ разрешён только владельцу супергруппы или администратору с правом «Управление темами» (Manage Topics).",
    blockedClub: "Этот клуб временно заблокирован администратором платформы.",
    pendingApproval:
      "Клуб находится на модерации. Публикация челленджей станет доступна сразу после подтверждения заявки администратором ExtraPawn.",
    botRemoved:
      "Бот удалён из этой супергруппы. Добавьте @ExtraPawnTeleBot обратно в чат.",
    maxIntervals: "Не более 8 интервалов на один день недели.",
    invalidIntervalBounds:
      "Время начала интервала должно быть меньше времени окончания.",
    overlappingIntervals:
      "Интервалы расписания в пределах одного дня не должны пересекаться.",
    invalidLanguage: "Выберите язык группы: EN, DE или RU.",
  },
  en: {
    notFound: "Club not found",
    forbiddenManager:
      "Access is restricted to the supergroup owner or an administrator with the 'Manage Topics' permission.",
    blockedClub: "This club is temporarily blocked by the platform administrator.",
    pendingApproval:
      "This club is awaiting moderator approval. Challenges will unlock once approved by the ExtraPawn administrator.",
    botRemoved:
      "The bot was removed from this supergroup. Please add @ExtraPawnTeleBot back to the chat.",
    maxIntervals: "Maximum 8 intervals per day of the week.",
    invalidIntervalBounds:
      "Interval start time must be earlier than end time.",
    overlappingIntervals:
      "Schedule intervals within the same day must not overlap.",
    invalidLanguage: "Please select a group language: EN, DE, or RU.",
  },
  de: {
    notFound: "Klub nicht gefunden",
    forbiddenManager:
      "Zugriff ist nur dem Eigentümer der Supergruppe oder einem Administrator mit dem Recht „Themen verwalten“ (Manage Topics) gestattet.",
    blockedClub:
      "Dieser Klub ist vom Plattform-Administrator vorübergehend gesperrt.",
    pendingApproval:
      "Dieser Klub wartet auf die Freigabe durch den Moderator. Challenges werden nach der Genehmigung freigeschaltet.",
    botRemoved:
      "Der Bot wurde aus dieser Supergruppe entfernt. Bitte fügen Sie @ExtraPawnTeleBot wieder zum Chat hinzu.",
    maxIntervals: "Maximal 8 Intervalle pro Wochentag.",
    invalidIntervalBounds:
      "Die Startzeit eines Intervalls muss vor der Endzeit liegen.",
    overlappingIntervals:
      "Zeitplan-Intervalle innerhalb desselben Tages dürfen sich nicht überschneiden.",
    invalidLanguage: "Bitte wählen Sie eine Gruppensprache: EN, DE oder RU.",
  },
} as const;

export type ClubRouteErrors = (typeof CLUB_ROUTE_ERRORS)[keyof typeof CLUB_ROUTE_ERRORS];

export function getClubRouteErrors(rawLang?: string | null): ClubRouteErrors {
  if (rawLang === "en" || rawLang === "de") {
    return CLUB_ROUTE_ERRORS[rawLang];
  }
  return CLUB_ROUTE_ERRORS.ru;
}

export function validateWeeklyScheduleIntervals(
  weeklySchedule: WeeklyScheduleConfig,
  errs: ClubRouteErrors
): string | null {
  for (const day of ALL_DAYS_OF_WEEK) {
    const slots = weeklySchedule[day].slots;
    if (slots.length > 8) {
      return errs.maxIntervals;
    }
    for (let i = 0; i < slots.length; i += 1) {
      const cur = slots[i];
      if (!cur || cur.from_hour >= cur.to_hour) {
        return errs.invalidIntervalBounds;
      }
      if (i > 0) {
        const prev = slots[i - 1];
        if (prev && cur.from_hour < prev.to_hour) {
          return errs.overlappingIntervals;
        }
      }
    }
  }
  return null;
}
