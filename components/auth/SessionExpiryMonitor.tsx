"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { SESSION_EXPIRED_QUERY_PARAM, SESSION_EXPIRED_QUERY_VALUE } from "@/lib/auth/session-expiration";

export default function SessionExpiryMonitor() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let hadSession = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") {
        hadSession = Boolean(session);
        return;
      }

      if (session) {
        hadSession = true;
        return;
      }

      if (event !== "SIGNED_OUT" || !hadSession) return;
      hadSession = false;

      const originalPath = window.location.pathname;
      if (originalPath === "/") return;

      // Explicit logout flows navigate away immediately; only redirect if this route stays put.
      window.setTimeout(() => {
        if (window.location.pathname !== originalPath) return;
        const loginUrl = new URL("/", window.location.origin);
        loginUrl.searchParams.set(SESSION_EXPIRED_QUERY_PARAM, SESSION_EXPIRED_QUERY_VALUE);
        router.replace(`${loginUrl.pathname}${loginUrl.search}`);
      }, 150);
    });

    return () => subscription.unsubscribe();
  }, [router]);

  return null;
}