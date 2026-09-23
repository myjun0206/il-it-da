import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  decideServerRoleAccess,
  isServerRole,
  requireServerRole,
  type ServerRole,
} from "../../lib/auth/server-role-guard-core.ts";

type FakeUser = { id: string; user_metadata?: Record<string, unknown> } | null;

function fakeSessionClient(options: { user?: FakeUser; userError?: unknown }): SupabaseClient {
  return {
    auth: {
      getUser: async () => {
        if (options.userError) {
          return { data: { user: null }, error: options.userError };
        }
        return { data: { user: options.user ?? null }, error: null };
      },
    },
  } as unknown as SupabaseClient;
}

function fakeAdminClient(options: {
  role?: string | null;
  profileError?: unknown;
  onFrom?: (table: string) => void;
}): SupabaseClient {
  return {
    from: (table: string) => {
      options.onFrom?.(table);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (options.profileError) {
                return { data: null, error: options.profileError };
              }
              return {
                data: options.role === undefined ? null : { role: options.role },
                error: null,
              };
            },
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

function spyLogAuthError(): { calls: Array<[string, unknown]>; logAuthError: (code: string, error: unknown) => void } {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    logAuthError: (code, error) => {
      calls.push([code, error]);
    },
  };
}

describe("decideServerRoleAccess (pure role decision)", () => {
  test("rejects when userId is missing (not logged in)", () => {
    const result = decideServerRoleAccess("hq", null, "hq");
    assert.deepEqual(result, { status: "UNAUTHENTICATED" });
  });

  test("rejects when profile role is missing", () => {
    const result = decideServerRoleAccess("hq", "user-1", null);
    assert.deepEqual(result, { status: "FORBIDDEN" });
  });

  test("rejects an unknown role value", () => {
    const result = decideServerRoleAccess("hq", "user-1", "manager");
    assert.deepEqual(result, { status: "FORBIDDEN" });
  });

  const matchingCases: Array<[ServerRole, ServerRole]> = [
    ["hq", "hq"],
    ["owner", "owner"],
    ["staff", "staff"],
  ];
  for (const [profileRole, requiredRole] of matchingCases) {
    test(`allows ${profileRole} on a ${requiredRole}-required path`, () => {
      const result = decideServerRoleAccess(requiredRole, "user-1", profileRole);
      assert.deepEqual(result, { status: "AUTHORIZED", userId: "user-1", role: requiredRole });
    });
  }

  const mismatchCases: Array<[ServerRole, ServerRole]> = [
    ["hq", "owner"],
    ["hq", "staff"],
    ["owner", "hq"],
    ["owner", "staff"],
    ["staff", "hq"],
    ["staff", "owner"],
  ];
  for (const [profileRole, requiredRole] of mismatchCases) {
    test(`rejects ${profileRole} on a ${requiredRole}-required path`, () => {
      const result = decideServerRoleAccess(requiredRole, "user-1", profileRole);
      assert.deepEqual(result, { status: "FORBIDDEN" });
    });
  }

  test("isServerRole rejects values outside hq/owner/staff", () => {
    assert.equal(isServerRole("hq"), true);
    assert.equal(isServerRole("owner"), true);
    assert.equal(isServerRole("staff"), true);
    assert.equal(isServerRole("boss"), false);
    assert.equal(isServerRole("pending"), false);
    assert.equal(isServerRole(undefined), false);
  });
});

describe("requireServerRole (injected Supabase clients, no network)", () => {
  test("rejects when there is no session user", async () => {
    const result = await requireServerRole("hq", {
      getSessionClient: async () => fakeSessionClient({ user: null }),
      getAdminClient: () => fakeAdminClient({ role: "hq" }),
    });
    assert.deepEqual(result, { status: "UNAUTHENTICATED" });
  });

  test("rejects when auth.getUser() errors, without leaking the raw error to the injected logger", async () => {
    const { calls, logAuthError } = spyLogAuthError();
    const result = await requireServerRole("hq", {
      getSessionClient: async () =>
        fakeSessionClient({ userError: new Error("refresh token invalid for user@example.com") }),
      getAdminClient: () => fakeAdminClient({ role: "hq" }),
      logAuthError,
    });

    assert.deepEqual(result, { status: "UNAUTHENTICATED" });
    assert.equal(calls.length, 1);
    const [code, error] = calls[0];
    assert.match(code, /REQUIRE_SERVER_ROLE_AUTH_FAILED/);
    // The guard only forwards the raw error to the caller-supplied safe logger; it never
    // formats/logs the message itself, so nothing here should ever surface the email.
    assert.equal(JSON.stringify(calls).includes("user@example.com"), false);
    assert.ok(error instanceof Error);
  });

  test("rejects when the profile does not exist", async () => {
    const result = await requireServerRole("hq", {
      getSessionClient: async () => fakeSessionClient({ user: { id: "user-1" } }),
      getAdminClient: () => fakeAdminClient({ role: undefined }),
    });
    assert.deepEqual(result, { status: "FORBIDDEN" });
  });

  test("rejects when the profile lookup errors, and forwards (not formats) the raw error to the safe logger", async () => {
    const rawError = { message: "relation profiles unreachable", details: "conn refused", hint: null, code: "500" };
    const { calls, logAuthError } = spyLogAuthError();
    const result = await requireServerRole("hq", {
      getSessionClient: async () => fakeSessionClient({ user: { id: "user-1" } }),
      getAdminClient: () => fakeAdminClient({ profileError: rawError }),
      logAuthError,
    });

    assert.deepEqual(result, { status: "FORBIDDEN" });
    assert.equal(calls.length, 1);
    const [code, error] = calls[0];
    assert.match(code, /REQUIRE_SERVER_ROLE_PROFILE_LOOKUP_FAILED/);
    assert.equal(error, rawError);
  });

  test("does not throw and logs nothing when no logAuthError dependency is supplied", async () => {
    const result = await requireServerRole("hq", {
      getSessionClient: async () => fakeSessionClient({ userError: new Error("boom") }),
      getAdminClient: () => fakeAdminClient({ role: "hq" }),
    });
    assert.deepEqual(result, { status: "UNAUTHENTICATED" });
  });

  test("allows an HQ user on an hq-required path", async () => {
    const result = await requireServerRole("hq", {
      getSessionClient: async () => fakeSessionClient({ user: { id: "hq-user" } }),
      getAdminClient: () => fakeAdminClient({ role: "hq" }),
    });
    assert.deepEqual(result, { status: "AUTHORIZED", userId: "hq-user", role: "hq" });
  });

  test("allows an owner user on an owner-required (/boss) path", async () => {
    const result = await requireServerRole("owner", {
      getSessionClient: async () => fakeSessionClient({ user: { id: "owner-user" } }),
      getAdminClient: () => fakeAdminClient({ role: "owner" }),
    });
    assert.deepEqual(result, { status: "AUTHORIZED", userId: "owner-user", role: "owner" });
  });

  test("allows a staff user on a staff-required path", async () => {
    const result = await requireServerRole("staff", {
      getSessionClient: async () => fakeSessionClient({ user: { id: "staff-user" } }),
      getAdminClient: () => fakeAdminClient({ role: "staff" }),
    });
    assert.deepEqual(result, { status: "AUTHORIZED", userId: "staff-user", role: "staff" });
  });

  test("rejects an HQ profile on owner/staff-required paths", async () => {
    for (const requiredRole of ["owner", "staff"] as const) {
      const result = await requireServerRole(requiredRole, {
        getSessionClient: async () => fakeSessionClient({ user: { id: "hq-user" } }),
        getAdminClient: () => fakeAdminClient({ role: "hq" }),
      });
      assert.deepEqual(result, { status: "FORBIDDEN" });
    }
  });

  test("ignores user_metadata.role and trusts only public.profiles.role", async () => {
    const result = await requireServerRole("hq", {
      getSessionClient: async () =>
        fakeSessionClient({ user: { id: "user-1", user_metadata: { role: "hq" } } }),
      // profiles.role disagrees with the metadata role a client could have sent at signup.
      getAdminClient: () => fakeAdminClient({ role: "staff" }),
    });
    assert.deepEqual(result, { status: "FORBIDDEN" });
  });

  test("never queries store_memberships / pending-rejected status from the role guard", async () => {
    const queriedTables: string[] = [];
    const result = await requireServerRole("staff", {
      getSessionClient: async () => fakeSessionClient({ user: { id: "staff-user" } }),
      getAdminClient: () =>
        fakeAdminClient({ role: "staff", onFrom: (table) => queriedTables.push(table) }),
    });

    assert.deepEqual(result, { status: "AUTHORIZED", userId: "staff-user", role: "staff" });
    assert.deepEqual(queriedTables, ["profiles"]);
    assert.equal(queriedTables.includes("store_memberships"), false);
  });
});
