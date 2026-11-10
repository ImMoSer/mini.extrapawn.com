import { resolveRouteFromStartParam } from "shared";

export function initTelegramWebApp(): void {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    // Official Bot API 7.7+ method: prevents swipe-down-to-collapse while
    // keeping native internal scrolling and 1-tap close via the 'X' button.
    if (typeof tg.disableVerticalSwipes === "function") {
      tg.disableVerticalSwipes();
    } else if (typeof tg.enableClosingConfirmation === "function") {
      tg.enableClosingConfirmation();
    }
  } catch (err) {
    console.warn("[TelegramWebApp] init warning:", err);
  }
}

export function getTelegramInitData(): string {
  return window.Telegram?.WebApp?.initData || "";
}

export function getInitialDeepLinkRoute(): string | null {
  const urlParams = new URLSearchParams(window.location.search);
  const queryStartParam =
    urlParams.get("tgWebAppStartParam") || urlParams.get("startapp") || "";
  const sdkStartParam =
    window.Telegram?.WebApp?.initDataUnsafe?.start_param || "";
  const raw = (sdkStartParam || queryStartParam).trim();

  if (!raw || raw === "cabinet") return null;
  return resolveRouteFromStartParam(raw);
}

export function triggerHapticImpact(
  style: "light" | "medium" | "heavy" = "light"
): void {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  } catch {
    // Ignore outside Telegram environment
  }
}

export function triggerHapticNotification(
  type: "error" | "success" | "warning"
): void {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(type);
  } catch {
    // Ignore outside Telegram environment
  }
}

export function openTelegramUrl(url: string): void {
  const tg = window.Telegram?.WebApp;
  if (tg && url.startsWith("https://t.me/")) {
    tg.openTelegramLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

