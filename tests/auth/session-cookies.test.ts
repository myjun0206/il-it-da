import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createChunks } from "@supabase/ssr";

import {
  isLegacySupabaseAuthCookie,
  parseBrowserCookies,
  serializeBrowserCookie,
  toSessionCookieOptions,
} from "../../lib/supabase/session-cookies.ts";

describe("Supabase session cookie policy", () => {
  test("removes persistent lifetime attributes from session cookies", () => {
    const result = toSessionCookieOptions("session", {
      path: "/",
      sameSite: "lax",
      maxAge: 400 * 24 * 60 * 60,
      expires: new Date("2030-01-01T00:00:00.000Z"),
    });

    assert.deepEqual(result, { path: "/", sameSite: "lax" });
  });

  test("retains explicit expiry when removing stale cookie chunks", () => {
    assert.deepEqual(toSessionCookieOptions("", { path: "/", maxAge: 0 }), {
      path: "/",
      maxAge: 0,
    });
  });

  test("serializes new session cookies without a persistent lifetime", () => {
    const result = serializeBrowserCookie("auth", "token", {
      path: "/",
      sameSite: "lax",
      maxAge: 86400,
    });

    assert.equal(result, "auth=token; Path=/; SameSite=Lax");
  });

  test("parses cookie values and identifies legacy Supabase auth chunks", () => {
    assert.deepEqual(parseBrowserCookies("theme=dark; token=one%20two"), [
      { name: "theme", value: "dark" },
      { name: "token", value: "one two" },
    ]);
    assert.equal(isLegacySupabaseAuthCookie("sb-project-auth-token"), true);
    assert.equal(isLegacySupabaseAuthCookie("sb-project-auth-token.2"), true);
    assert.equal(isLegacySupabaseAuthCookie("il-it-da-auth-session"), false);
  });

  test("round-trips every chunk of a large Supabase session cookie", () => {
    const storageKey = "il-it-da-auth-session";
    const storedValue = `base64-${"token%payload".repeat(700)}`;
    const chunks = createChunks(storageKey, storedValue);
    const browserCookieHeader = chunks
      .map(({ name, value }) =>
        serializeBrowserCookie(name, value, { path: "/", sameSite: "lax" }).split(";")[0],
      )
      .join("; ");
    const parsedChunks = parseBrowserCookies(browserCookieHeader);

    assert.ok(chunks.length > 1);
    assert.deepEqual(parsedChunks, chunks);
    assert.equal(parsedChunks.map(({ value }) => value).join(""), storedValue);
  });
});