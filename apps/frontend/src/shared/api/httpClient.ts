import { getTelegramInitData } from "../lib/telegram";

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const initData = getTelegramInitData();
  const headers = new Headers(options.headers || {});

  headers.set("Authorization", `tma ${initData || "mock"}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API ${response.status}: ${errText}`);
  }

  return (await response.json()) as T;
}

