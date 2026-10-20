import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_ORIGIN = "https://cuevacoin.robvg9.workers.dev";
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_IP = 6;
const MAX_REQUESTS_PER_PROFILE = 3;
const attempts = new Map<string, { count: number; resetAt: number }>();

const corsHeaders = {
  "Access-Control-Allow-Headers": "apikey, authorization, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Vary": "Origin",
};
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Access-Control-Allow-Origin": APP_ORIGIN },
  });
}
function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
function allowAttempt(ip: string): boolean {
  const now = Date.now();
  const old = attempts.get(ip);
  if (!old || old.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  old.count += 1;
  if (attempts.size > 4096) {
    for (const [key, value] of attempts) if (value.resetAt <= now) attempts.delete(key);
  }
  return old.count <= MAX_ATTEMPTS_PER_IP;
}
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
function invalidRecovery() {
  return reply({ error: "RECOVERY_INVALID" }, 400);
}
function hashText(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}
async function tokenHash(value: string): Promise<string> {
  const digest = new Uint8Array(await hashText(value));
  return Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
}
function validContactEmail(value: unknown): value is string {
  return typeof value === "string" &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim()) &&
    !/@cuevacoin\.local$/i.test(value.trim());
}

async function findAuthUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error("AUTH_EMAIL_LOOKUP_FAILED");
  const users = data?.users || [];
  const match = users.find((user: { email?: string | null }) =>
    String(user.email || "").trim().toLowerCase() === email.trim().toLowerCase()
  );
  // Don't create a second identity if a large project response might hide an existing user.
  if (!match && users.length >= 1000) throw new Error("AUTH_EMAIL_LOOKUP_INCOMPLETE");
  return match || null;
}

async function deleteOrphanRecoveryAuthUser(
  admin: ReturnType<typeof createClient>,
  profileId: string,
  authUserId: string | null | undefined,
  createdByRecovery: boolean
) {
  if (!createdByRecovery || !authUserId || authUserId === profileId) return;
  const { count, error } = await admin.from("perfiles")
    .select("id", { count: "exact", head: true }).eq("id", authUserId);
  if (error || (count || 0) > 0) {
    console.warn("[recuperar-contrasena] temporary auth identity retained because profile linkage could not be ruled out");
    return;
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(authUserId);
  if (deleteError) console.warn("[recuperar-contrasena] temporary auth identity cleanup failed");
}

async function findActiveProfile(admin: ReturnType<typeof createClient>, identifier: string) {
  if (!identifier || identifier.length > 120 || /[\r\n\0]/.test(identifier)) return null;
  const column = identifier.includes("@") ? "correo" : "usuario";
  const { data, error } = await admin.from("perfiles")
    .select("id, usuario, correo, estado")
    .ilike(column, escapeLike(identifier))
    .maybeSingle();
  if (error) throw new Error("PROFILE_LOOKUP_FAILED");
  if (!data || data.estado !== "activo" || !validContactEmail(data.correo)) return null;
  // One shared mailbox must never be able to reset more than one CuevaCoin account.
  const { count, error: duplicateError } = await admin.from("perfiles")
    .select("id", { count: "exact", head: true })
    .ilike("correo", escapeLike(data.correo.trim()));
  if (duplicateError) throw new Error("PROFILE_EMAIL_LOOKUP_FAILED");
  if ((count || 0) !== 1) return null;
  return { id: data.id as string, correo: data.correo.trim() as string };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin !== APP_ORIGIN) return reply({ error: "Origen no permitido." }, 403);
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204, headers: { ...corsHeaders, "Access-Control-Allow-Origin": APP_ORIGIN },
  });
  if (req.method !== "POST") return reply({ error: "Método no permitido." }, 405);

  const ip = clientIp(req);
  if (!allowAttempt(ip)) return reply({ error: "RECOVERY_RATE_LIMIT" }, 429);
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 4096) return reply({ error: "Solicitud inválida." }, 400);

  let body: { identifier?: unknown; mode?: unknown; code?: unknown; newPassword?: unknown; rid?: unknown; token?: unknown };
  try { body = await req.json(); } catch { return reply({ error: "Solicitud inválida." }, 400); }

  const mode = typeof body.mode === "string" ? body.mode : "";
  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword && (newPassword.length < 8 || newPassword.length > 128)) {
    return reply({ error: "La nueva contraseña debe tener entre 8 y 128 caracteres." }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRole) {
    return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 503);
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(url, serviceRole, options);
  const publicAuth = createClient(url, anonKey, options);

  try {
    // Request may be initiated with username or profile contact email.
    if (mode === "request") {
      if (!identifier || identifier.length > 120) return reply({ error: "Solicitud inválida." }, 400);
      const profile = await findActiveProfile(admin, identifier);
      if (!profile) {
        // Generic response for an unknown/inactive profile; never provide profile or email details.
        return reply({ accepted: true }, 202);
      }

      const since = new Date(Date.now() - WINDOW_MS).toISOString();
      const { count: recentRequests, error: rateError } = await admin
        .from("password_recovery_requests")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", profile.id)
        .gte("created_at", since);
      if (rateError) {
        console.error("[recuperar-contrasena] database gate failed");
        return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 503);
      }
      if ((recentRequests || 0) >= MAX_REQUESTS_PER_PROFILE) {
        return reply({ error: "RECOVERY_RATE_LIMIT" }, 429);
      }

      // Garbage collection is bounded; expired and consumed tokens are not usable.
      await admin.from("password_recovery_requests")
        .delete().lt("expires_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

      const rid = crypto.randomUUID();
      const rawToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      const hash = await tokenHash(rawToken);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const { error: insertError } = await admin.from("password_recovery_requests").insert({
        id: rid,
        token_hash: hash,
        profile_id: profile.id,
        contact_email: profile.correo,
        expires_at: expiresAt,
      });
      if (insertError) {
        console.error("[recuperar-contrasena] request token could not be stored");
        return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 503);
      }

      // Use a mailbox identity for delivery, while retaining the original CuevaCoin profile UUID.
      // BattleCruiser uses resetPasswordForEmail (the Recovery template), not signInWithOtp (Magic Link template).
      let transportAuthUser = await findAuthUserByEmail(admin, profile.correo);
      let shadowUserCreated = false;

      if (!transportAuthUser) {
        const { data: createdAuthUser, error: createAuthUserError } =
          await admin.auth.admin.createUser({
            email: profile.correo,
            email_confirm: true,
          });
        if (createAuthUserError || !createdAuthUser?.user) {
          // Handle a concurrent request that registered the mailbox between lookup and creation.
          transportAuthUser = await findAuthUserByEmail(admin, profile.correo).catch(() => null);
          if (!transportAuthUser) {
            await admin.from("password_recovery_requests")
              .update({ consumed_at: new Date().toISOString() }).eq("id", rid);
            console.error("[recuperar-contrasena] recovery transport identity could not be prepared", {
              code: createAuthUserError?.code || "UNKNOWN",
              status: createAuthUserError?.status || 0,
            });
            return reply({ error: "RECOVERY_EMAIL_UNAVAILABLE" }, 502);
          }
        } else {
          transportAuthUser = createdAuthUser.user;
          shadowUserCreated = true;
        }
      }

      // Reuse the BattleCruiser recovery API and its dedicated Supabase Auth email template.
      const redirect = new URL("/", APP_ORIGIN);
      redirect.searchParams.set("cc_recovery", "1");
      redirect.searchParams.set("rid", rid);
      redirect.searchParams.set("rt", rawToken);
      const { error: sendError } = await publicAuth.auth.resetPasswordForEmail(profile.correo, {
        redirectTo: redirect.toString(),
      });
      if (sendError) {
        await admin.from("password_recovery_requests")
          .update({ consumed_at: new Date().toISOString() }).eq("id", rid);
        await deleteOrphanRecoveryAuthUser(
          admin, profile.id, transportAuthUser?.id, shadowUserCreated
        );
        console.error("[recuperar-contrasena] recovery email request rejected", {
          code: sendError.code || "UNKNOWN",
          status: sendError.status || 0,
        });
        if (sendError.status === 429 || /rate.?limit/i.test(sendError.message || "")) {
          return reply({ error: "RECOVERY_RATE_LIMIT" }, 429);
        }
        return reply({ error: "RECOVERY_EMAIL_UNAVAILABLE" }, 502);
      }

      const { error: tokenUpdateError } = await admin.from("password_recovery_requests")
        .update({
          mail_auth_user_id: transportAuthUser?.id || null,
          shadow_user_created_by_recovery: shadowUserCreated,
        }).eq("id", rid);
      if (tokenUpdateError) {
        console.error("[recuperar-contrasena] recovery token state update failed");
        return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 503);
      }
      return reply({ accepted: true }, 202);
    }

    if (mode === "complete") {
      if (!identifier || identifier.length > 120 || !/^\d{6}$/.test(code) ||
          newPassword.length < 8 || newPassword.length > 128) return invalidRecovery();
      const profile = await findActiveProfile(admin, identifier);
      if (!profile) return invalidRecovery();

      const { data: verified, error: verifyError } = await publicAuth.auth.verifyOtp({
        email: profile.correo, token: code, type: "recovery",
      });
      if (verifyError || !verified.user ||
          verified.user.email?.trim().toLowerCase() !== profile.correo.toLowerCase()) {
        return invalidRecovery();
      }
      const { data: recoveryRequest } = await admin.from("password_recovery_requests")
        .select("id, mail_auth_user_id, shadow_user_created_by_recovery")
        .eq("profile_id", profile.id).is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (recoveryRequest?.mail_auth_user_id && recoveryRequest.mail_auth_user_id !== verified.user.id) {
        return invalidRecovery();
      }
      const { error: updateError } = await admin.auth.admin.updateUserById(profile.id, { password: newPassword });
      if (updateError) {
        console.error("[recuperar-contrasena] password update failed");
        return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 500);
      }
      await admin.from("password_recovery_requests")
        .update({ consumed_at: new Date().toISOString() })
        .eq("profile_id", profile.id).is("consumed_at", null);
      if (recoveryRequest) {
        await deleteOrphanRecoveryAuthUser(
          admin, profile.id, recoveryRequest.mail_auth_user_id,
          recoveryRequest.shadow_user_created_by_recovery
        );
      }
      return reply({ success: true }, 200);
    }

    if (mode === "complete-link") {
      const rid = typeof body.rid === "string" ? body.rid : "";
      const rawToken = typeof body.token === "string" ? body.token : "";
      const authorization = req.headers.get("authorization") || "";
      if (!rid || rid.length > 80 || !rawToken || rawToken.length > 128 ||
          newPassword.length < 8 || newPassword.length > 128 ||
          !authorization.toLowerCase().startsWith("bearer ")) return invalidRecovery();

      const scopedAuth = createClient(url, anonKey, {
        ...options,
        global: { headers: { Authorization: authorization } },
      });
      const { data: userData, error: userError } = await scopedAuth.auth.getUser();
      if (userError || !userData.user?.email) return invalidRecovery();

      const { data: request, error: requestError } = await admin
        .from("password_recovery_requests")
        .select("id, token_hash, profile_id, contact_email, expires_at, consumed_at, mail_auth_user_id, shadow_user_created_by_recovery")
        .eq("id", rid).maybeSingle();
      if (requestError || !request || request.consumed_at ||
          new Date(request.expires_at).getTime() <= Date.now()) return invalidRecovery();
      if (await tokenHash(rawToken) !== request.token_hash ||
          userData.user.email.trim().toLowerCase() !== String(request.contact_email).trim().toLowerCase() ||
          (request.mail_auth_user_id && request.mail_auth_user_id !== userData.user.id)) {
        return invalidRecovery();
      }

      const { data: profileRow, error: profileError } = await admin.from("perfiles")
        .select("id, usuario, correo, estado")
        .eq("id", request.profile_id)
        .maybeSingle();
      if (profileError || !profileRow || profileRow.estado !== "activo" ||
          !validContactEmail(profileRow.correo) ||
          profileRow.correo.trim().toLowerCase() !== String(request.contact_email).trim().toLowerCase()) {
        return invalidRecovery();
      }
      const { count: duplicateEmailCount, error: duplicateError } = await admin.from("perfiles")
        .select("id", { count: "exact", head: true })
        .ilike("correo", escapeLike(profileRow.correo.trim()));
      if (duplicateError || (duplicateEmailCount || 0) !== 1) return invalidRecovery();
      const profile = { id: profileRow.id as string, correo: profileRow.correo.trim() as string };

      const { error: updateError } = await admin.auth.admin.updateUserById(profile.id, { password: newPassword });
      if (updateError) {
        console.error("[recuperar-contrasena] linked password update failed");
        return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 500);
      }
      await admin.from("password_recovery_requests")
        .update({ consumed_at: new Date().toISOString() }).eq("id", rid);
      await deleteOrphanRecoveryAuthUser(
        admin, profile.id, request.mail_auth_user_id,
        request.shadow_user_created_by_recovery
      );
      return reply({ success: true }, 200);
    }

    return reply({ error: "Modo de recuperación no válido." }, 400);
  } catch (_error) {
    console.error("[recuperar-contrasena] unexpected recovery failure");
    return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 503);
  }
});