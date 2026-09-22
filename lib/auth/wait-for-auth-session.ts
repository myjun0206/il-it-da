import type { SupabaseClient, User } from "@supabase/supabase-js";

const RETRY_DELAYS_MS = [0, 100, 250, 500];

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function waitForAuthenticatedUser(
  supabase: SupabaseClient,
): Promise<User | null> {
  for (const delayMs of RETRY_DELAYS_MS) {
    if (delayMs > 0) await wait(delayMs);

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) continue;

    const { data: userData, error } = await supabase.auth.getUser();
    if (!error && userData.user) return userData.user;
  }

  return null;
}

export async function waitForServerAuthSession(): Promise<boolean> {
  for (const delayMs of RETRY_DELAYS_MS) {
    if (delayMs > 0) await wait(delayMs);

    const response = await fetch("/api/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    if (response.ok) return true;
  }

  return false;
}

export async function waitForAuthReadiness(
  supabase: SupabaseClient,
): Promise<User | null> {
  const user = await waitForAuthenticatedUser(supabase);
  if (!user) return null;

  return (await waitForServerAuthSession()) ? user : null;
}

export async function fetchWithAuthRetry(
  supabase: SupabaseClient,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status !== 401) return response;

  const user = await waitForAuthReadiness(supabase);
  if (!user) return response;

  return fetch(input, init);
}