import { randomBytes } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export const SYSTEM_ORPHAN_OWNER_EMAIL = "system-unassigned@il-it-da.internal";
const SYSTEM_MARKER = "orphan-owner";
const SYSTEM_BAN_DURATION = "876000h";
const AUTH_USER_PAGE_SIZE = 1000;

export type SystemOrphanOwner = {
  userId: string;
  profileId: string;
};

type OrphanProfileRow = {
  id: string;
  user_id: string;
  email: string;
  role: string;
  brand_id: string | null;
};

async function findAuthUserByEmail(client: SupabaseClient, email: string): Promise<User | null> {
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: AUTH_USER_PAGE_SIZE,
    });
    if (error) throw error;

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < AUTH_USER_PAGE_SIZE) return null;
  }
}

async function findSystemProfile(client: SupabaseClient, userId: string): Promise<OrphanProfileRow | null> {
  const { data, error } = await client
    .from("profiles")
    .select("id, user_id, email, role, brand_id")
    .eq("user_id", userId)
    .eq("email", SYSTEM_ORPHAN_OWNER_EMAIL)
    .eq("role", "owner")
    .is("brand_id", null)
    .maybeSingle<OrphanProfileRow>();
  if (error) throw error;
  return data;
}

async function ensureAuthUser(client: SupabaseClient): Promise<User> {
  const existingUser = await findAuthUserByEmail(client, SYSTEM_ORPHAN_OWNER_EMAIL);
  let user = existingUser;

  if (user && user.app_metadata?.system_account !== SYSTEM_MARKER) {
    throw new Error("Reserved orphan-owner email is already used by a non-system account.");
  }

  if (!user) {
    const { data, error } = await client.auth.admin.createUser({
      email: SYSTEM_ORPHAN_OWNER_EMAIL,
      password: randomBytes(48).toString("base64url"),
      email_confirm: true,
      ban_duration: SYSTEM_BAN_DURATION,
      app_metadata: { system_account: SYSTEM_MARKER },
      user_metadata: { name: "시스템 미지정 소유자", role: "owner" },
    });

    if (error) {
      // A concurrent request may have created the reserved account after listUsers.
      user = await findAuthUserByEmail(client, SYSTEM_ORPHAN_OWNER_EMAIL);
      if (!user || user.app_metadata?.system_account !== SYSTEM_MARKER) throw error;
    } else {
      user = data.user;
    }
  }

  if (!user) throw new Error("Failed to provision the system orphan-owner account.");
  return user;
}

export async function ensureSystemOrphanOwner(client: SupabaseClient): Promise<SystemOrphanOwner> {
  let authUser: User | null = null;
  const { data: profileByEmail, error: profileLookupError } = await client
    .from("profiles")
    .select("id, user_id, email, role, brand_id")
    .eq("email", SYSTEM_ORPHAN_OWNER_EMAIL)
    .eq("role", "owner")
    .is("brand_id", null)
    .maybeSingle<OrphanProfileRow>();
  if (profileLookupError) throw profileLookupError;

  if (profileByEmail) {
    const { data, error } = await client.auth.admin.getUserById(profileByEmail.user_id);
    if (error || !data.user || data.user.email?.toLowerCase() !== SYSTEM_ORPHAN_OWNER_EMAIL) {
      throw error ?? new Error("System orphan-owner profile has no matching Auth user.");
    }
    authUser = data.user;
    if (authUser.app_metadata?.system_account !== SYSTEM_MARKER) {
      throw new Error("Reserved orphan-owner profile does not belong to the system account.");
    }
  } else {
    authUser = await ensureAuthUser(client);
  }

  if (!authUser) throw new Error("System orphan-owner account is unavailable.");

  const { data: updatedUser, error: banError } = await client.auth.admin.updateUserById(authUser.id, {
    ban_duration: SYSTEM_BAN_DURATION,
    app_metadata: { ...(authUser.app_metadata ?? {}), system_account: SYSTEM_MARKER },
  });
  if (banError || !updatedUser.user) throw banError ?? new Error("Failed to ban the system orphan-owner account.");
  authUser = updatedUser.user;

  const existingProfile = profileByEmail ?? await findSystemProfile(client, authUser.id);
  if (existingProfile) {
    return { userId: authUser.id, profileId: existingProfile.id };
  }

  const profile: OrphanProfileRow = {
    id: authUser.id,
    user_id: authUser.id,
    email: SYSTEM_ORPHAN_OWNER_EMAIL,
    role: "owner",
    brand_id: null,
  };
  const { error: insertError } = await client.from("profiles").insert({
    ...profile,
    full_name: "시스템 미지정 소유자",
    phone: null,
    company_email: null,
    approval_status: "approved",
    approved_at: new Date().toISOString(),
    approved_by: null,
  });

  if (insertError) {
    // Concurrent provisioning can win the unique profile insert; reuse its row.
    const concurrentProfile = await findSystemProfile(client, authUser.id);
    if (concurrentProfile) return { userId: authUser.id, profileId: concurrentProfile.id };
    throw insertError;
  }

  return { userId: authUser.id, profileId: profile.id };
}