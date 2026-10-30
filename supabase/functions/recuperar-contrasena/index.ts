import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@9.0.6";

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

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (char) => entities[char]);
}

function createRecoveryMailTransport() {
  const username = Deno.env.get("SMTP_USERNAME")?.trim();
  const password = Deno.env.get("SMTP_PASSWORD");
  if (!username || !password) throw new Error("RECOVERY_EMAIL_PROVIDER_NOT_CONFIGURED");
  const host = Deno.env.get("SMTP_HOSTNAME")?.trim() || "smtp.gmail.com";
  const port = Number(Deno.env.get("SMTP_PORT") || "465");
  const secureSetting = Deno.env.get("SMTP_SECURE");
  const secure = secureSetting ? secureSetting.trim().toLowerCase() === "true" : port === 465;
  const from = Deno.env.get("SMTP_FROM")?.trim() || username;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || (port === 465 && !secure)) {
    throw new Error("RECOVERY_SMTP_CONFIGURATION_INVALID");
  }
  const transport = nodemailer.createTransport({
    host, port, secure, auth: { user: username, pass: password },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
  });
  return { transport, from };
}

async function sendRecoveryEmail(to: string, actionLink: string) {
  const { transport, from } = createRecoveryMailTransport();
  const safeLink = escapeHtml(actionLink);
  const text = [
    "Se solicitó restablecer la contraseña de CuevaCoin.",
    "",
    "Abre la versión HTML de este correo y pulsa el botón «Restablecer contraseña».",
    "El botón caduca en 15 minutos y solo puede utilizarse una vez.",
    "",
    "Si no solicitaste esta recuperación, ignora este mensaje.",
  ].join("\n");
  const html = `<!doctype html>
<html lang="es"><body style="font-family:Arial,sans-serif;line-height:1.5;color:#202124">
<h2>Recuperación de contraseña — CuevaCoin</h2>
<p>Se solicitó restablecer la contraseña de tu cuenta.</p>
<p><a href="${safeLink}" style="display:inline-block;padding:12px 18px;background:#2457c5;color:#fff;text-decoration:none;border-radius:6px">Restablecer contraseña</a></p>
<p>El botón es de un solo uso y caduca en 15 minutos.</p>
<p>Si no solicitaste esta recuperación, ignora este mensaje.</p>
</body></html>`;
  try {
    await transport.sendMail({ from, to, subject: "Restablecer contraseña — CuevaCoin", text, html });
  } finally {
    transport.close();
  }
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

async function findActiveProfileForAdmin(admin: ReturnType<typeof createClient>, identifier: string) {
  if (!identifier || identifier.length > 120 || /[\\r\\n\\0]/.test(identifier)) return null;
  const column = identifier.includes("@") ? "correo" : "usuario";
  const { data, error } = await admin.from("perfiles")
    .select("id, usuario, nombre, estado, es_admin")
    .eq("estado", "activo")
    .eq("es_admin", false)
    .ilike(column, escapeLike(identifier))
    .maybeSingle();
  if (error) throw new Error("ADMIN_RECOVERY_PROFILE_LOOKUP_FAILED");
  return data || null;
}

function generateAdminRecoveryCode(): string {
  // 80 bits aleatorios, codificados en 16 caracteres Crockford Base32.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let buffer = 0;
  let bits = 0;
  let output = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(buffer >>> bits) & 31];
    }
  }
  return output;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

async function getAuthenticatedAdmin(
  url: string,
  anonKey: string,
  admin: ReturnType<typeof createClient>,
  options: { auth: { persistSession: boolean; autoRefreshToken: boolean; detectSessionInUrl: boolean } },
  authorization: string,
) {
  if (!/^Bearer\\s+\\S+/i.test(authorization)) return null;
  const scopedAuth = createClient(url, anonKey, {
    ...options,
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await scopedAuth.auth.getUser();
  if (authError || !authData.user?.id) return null;
  const { data: profile, error } = await admin.from("perfiles")
    .select("id, usuario, nombre, es_admin, estado")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (error || !profile || profile.es_admin !== true || profile.estado !== "activo") return null;
  return profile;
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

  let body: { identifier?: unknown; mode?: unknown; newPassword?: unknown; rid?: unknown; token?: unknown; code?: unknown };
  try { body = await req.json(); } catch { return reply({ error: "Solicitud inválida." }, 400); }

  const mode = typeof body.mode === "string" ? body.mode : "";
  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
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

  try {
    // Administrative recovery queue: only an authenticated, active CuevaCoin admin may inspect/issue codes.
    if (mode === "admin-list" || mode === "admin-issue") {
      const adminProfile = await getAuthenticatedAdmin(
        url, anonKey, admin, options, req.headers.get("authorization") || ""
      );
      if (!adminProfile) return reply({ error: "ADMIN_REQUIRED" }, 403);

      if (mode === "admin-list") {
        const { data: requests, error: queueError } = await admin.from("password_recovery_requests")
          .select("id, profile_id, created_at, expires_at, status, admin_code_issued_at, admin_code_expires_at")
          .eq("recovery_method", "admin")
          .in("status", ["pending", "issued"])
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(50);
        if (queueError) return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 503);
        const profileIds = [...new Set((requests || []).map((item: any) => item.profile_id))];
        let profiles: any[] = [];
        if (profileIds.length) {
          const { data, error } = await admin.from("perfiles")
            .select("id, usuario, nombre, estado")
            .in("id", profileIds);
          if (error) return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 503);
          profiles = data || [];
        }
        const byId = new Map(profiles.map((profile: any) => [profile.id, profile]));
        const items = (requests || []).map((request: any) => {
          const profile = byId.get(request.profile_id);
          return {
            id: request.id,
            username: profile?.usuario || "Cuenta no disponible",
            name: profile?.nombre || profile?.usuario || "Trabajadora",
            created_at: request.created_at,
            status: request.status,
            code_expires_at: request.admin_code_expires_at,
          };
        }).filter((item: any) => item.status === "pending" || item.status === "issued");
        return reply({ requests: items }, 200);
      }

      const rid = typeof body.rid === "string" ? body.rid : "";
      if (!rid || rid.length > 80) return invalidRecovery();
      const { data: request, error: requestError } = await admin.from("password_recovery_requests")
        .select("id, profile_id, status, expires_at, admin_code_expires_at")
        .eq("id", rid)
        .eq("recovery_method", "admin")
        .maybeSingle();
      if (requestError || !request || !["pending", "issued"].includes(request.status) ||
          new Date(request.expires_at).getTime() <= Date.now()) return invalidRecovery();
      if (request.status === "issued" && request.admin_code_expires_at &&
          new Date(request.admin_code_expires_at).getTime() > Date.now()) {
        return reply({ error: "RECOVERY_CODE_ALREADY_ACTIVE" }, 409);
      }
      const { data: targetProfile, error: targetError } = await admin.from("perfiles")
        .select("id, usuario, nombre, estado, es_admin")
        .eq("id", request.profile_id)
        .maybeSingle();
      if (targetError || !targetProfile || targetProfile.estado !== "activo" || targetProfile.es_admin) {
        return invalidRecovery();
      }

      const code = generateAdminRecoveryCode();
      const now = new Date();
      const issuedAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      const { data: issued, error: issueError } = await admin.from("password_recovery_requests")
        .update({
          status: "issued",
          admin_code_hash: await tokenHash(code),
          admin_code_issued_at: issuedAt,
          admin_code_expires_at: expiresAt,
          admin_code_attempts: 0,
          admin_approved_by: adminProfile.id,
        })
        .eq("id", rid)
        .eq("status", request.status)
        .is("consumed_at", null)
        .select("id")
        .maybeSingle();
      if (issueError || !issued) return reply({ error: "RECOVERY_REQUEST_CHANGED" }, 409);

      const { error: auditError } = await admin.from("auditoria").insert({
        usuario_id: adminProfile.id,
        usuario_nombre: adminProfile.nombre || adminProfile.usuario,
        accion: `Generó código de recuperación de un solo uso para ${targetProfile.nombre || targetProfile.usuario} (${targetProfile.usuario}). Caduca en 15 minutos.`,
      });
      if (auditError) {
        await admin.from("password_recovery_requests")
          .update({ status: "rejected", admin_code_hash: null })
          .eq("id", rid).eq("status", "issued");
        console.error("[recuperar-contrasena] admin issuance audit failed");
        return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 503);
      }
      // El código en claro se entrega únicamente en esta respuesta y no se persiste.
      return reply({
        success: true,
        code,
        expires_at: expiresAt,
        username: targetProfile.usuario,
        name: targetProfile.nombre || targetProfile.usuario,
      }, 200);
    }

    // The worker requests an administrator-issued code; no email/SMS is sent.
    if (mode === "admin-request") {
      if (!identifier || identifier.length > 120) return reply({ error: "Solicitud inválida." }, 400);
      const profile = await findActiveProfileForAdmin(admin, identifier);
      // Same public response for unknown, archived and inactive users.
      if (!profile) return reply({ accepted: true }, 202);

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: recentRequests, error: rateError } = await admin.from("password_recovery_requests")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", profile.id)
        .eq("recovery_method", "admin")
        .gte("created_at", since);
      if (rateError) return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 503);
      if ((recentRequests || 0) >= 3) return reply({ error: "RECOVERY_RATE_LIMIT" }, 429);

      // Invalidate any earlier unapproved/unredeemed request for this account.
      const nowIso = new Date().toISOString();
      const { error: closeError } = await admin.from("password_recovery_requests")
        .update({ status: "rejected", admin_code_hash: null, consumed_at: nowIso })
        .eq("profile_id", profile.id)
        .eq("recovery_method", "admin")
        .in("status", ["pending", "issued"])
        .is("consumed_at", null);
      if (closeError) return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 503);

      const { error: insertError } = await admin.from("password_recovery_requests").insert({
        token_hash: await tokenHash(crypto.randomUUID()),
        profile_id: profile.id,
        contact_email: "",
        mail_auth_user_id: null,
        shadow_user_created_by_recovery: false,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        recovery_method: "admin",
        status: "pending",
      });
      if (insertError) {
        console.error("[recuperar-contrasena] admin request could not be stored");
        return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 503);
      }
      return reply({ accepted: true }, 202);
    }

    // Redeem a code issued by the administrator. The code is bound to the username/profile.
    if (mode === "admin-complete") {
      const code = typeof body.code === "string"
        ? body.code.toUpperCase().replace(/[\\s-]/g, "")
        : "";
      if (!identifier || identifier.length > 120 || !/^[A-HJ-NP-Z2-9]{16}$/.test(code) ||
          newPassword.length < 8 || newPassword.length > 128) return invalidRecovery();

      const profile = await findActiveProfileForAdmin(admin, identifier);
      if (!profile) return invalidRecovery();
      const { data: request, error: requestError } = await admin.from("password_recovery_requests")
        .select("id, admin_code_hash, admin_code_expires_at, admin_code_attempts, expires_at, consumed_at, status")
        .eq("profile_id", profile.id)
        .eq("recovery_method", "admin")
        .eq("status", "issued")
        .is("consumed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (requestError || !request || !request.admin_code_hash) return invalidRecovery();
      const now = Date.now();
      if (!request.admin_code_expires_at || new Date(request.admin_code_expires_at).getTime() <= now ||
          new Date(request.expires_at).getTime() <= now) {
        await admin.from("password_recovery_requests")
          .update({ status: "expired", admin_code_hash: null })
          .eq("id", request.id).eq("status", "issued");
        return invalidRecovery();
      }

      const attemptsSoFar = Number(request.admin_code_attempts || 0);
      const suppliedHash = await tokenHash(code);
      if (!constantTimeEqual(suppliedHash, request.admin_code_hash)) {
        const nextAttempts = Math.min(attemptsSoFar + 1, 5);
        await admin.from("password_recovery_requests")
          .update({
            admin_code_attempts: nextAttempts,
            ...(nextAttempts >= 5 ? { status: "rejected", admin_code_hash: null } : {}),
          })
          .eq("id", request.id)
          .eq("status", "issued")
          .eq("admin_code_attempts", attemptsSoFar)
          .is("consumed_at", null);
        return invalidRecovery();
      }

      // Reserve the request atomically before changing Auth; concurrent replays lose this compare-and-set.
      const { data: reserved, error: reserveError } = await admin.from("password_recovery_requests")
        .update({ status: "processing" })
        .eq("id", request.id)
        .eq("status", "issued")
        .eq("admin_code_attempts", attemptsSoFar)
        .is("consumed_at", null)
        .select("id")
        .maybeSingle();
      if (reserveError || !reserved) return invalidRecovery();

      const { error: passwordError } = await admin.auth.admin.updateUserById(profile.id, { password: newPassword });
      if (passwordError) {
        await admin.from("password_recovery_requests")
          .update({ status: "issued" })
          .eq("id", request.id).eq("status", "processing");
        console.error("[recuperar-contrasena] admin code password update failed");
        return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 503);
      }

      const completedAt = new Date().toISOString();
      const { error: finishError } = await admin.from("password_recovery_requests")
        .update({
          status: "completed",
          consumed_at: completedAt,
          admin_code_used_at: completedAt,
          admin_code_hash: null,
        })
        .eq("id", request.id)
        .eq("status", "processing");
      if (finishError) console.error("[recuperar-contrasena] admin recovery completion state could not be finalized");

      const { error: auditError } = await admin.from("auditoria").insert({
        usuario_id: profile.id,
        usuario_nombre: profile.nombre || profile.usuario,
        accion: "Restableció su contraseña mediante código administrativo de un solo uso.",
      });
      if (auditError) console.error("[recuperar-contrasena] admin recovery completion audit failed");
      return reply({ success: true }, 200);
    }

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
        mail_auth_user_id: profile.id,
        shadow_user_created_by_recovery: false,
        expires_at: expiresAt,
      });
      if (insertError) {
        console.error("[recuperar-contrasena] request token could not be stored");
        return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 503);
      }

      // Generate the Recovery link for the original Auth UUID, then deliver it to perfiles.correo.
      // The contact mailbox may be a linked Google identity while auth.users.email is internal.
      const { data: originalAuth, error: originalAuthError } = await admin.auth.admin.getUserById(profile.id);
      const originalAuthEmail = originalAuth?.user?.email?.trim();
      if (originalAuthError || !originalAuthEmail) {
        await admin.from("password_recovery_requests")
          .update({ consumed_at: new Date().toISOString() }).eq("id", rid);
        console.error("[recuperar-contrasena] original Auth account lookup failed");
        return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 503);
      }

      const redirect = new URL("/", APP_ORIGIN);
      redirect.searchParams.set("cc_recovery", "1");
      redirect.searchParams.set("rid", rid);
      redirect.searchParams.set("rt", rawToken);
      const { data: generatedLink, error: generateLinkError } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: originalAuthEmail,
        options: { redirectTo: redirect.toString() },
      });
      const actionLink = generatedLink?.properties?.action_link || "";
      if (generateLinkError || !actionLink) {
        await admin.from("password_recovery_requests")
          .update({ consumed_at: new Date().toISOString() }).eq("id", rid);
        console.error("[recuperar-contrasena] Recovery link generation failed", {
          code: generateLinkError?.code || "UNKNOWN",
          status: generateLinkError?.status || 0,
        });
        return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 503);
      }

      try {
        await sendRecoveryEmail(profile.correo, actionLink);
      } catch (sendError) {
        await admin.from("password_recovery_requests")
          .update({ consumed_at: new Date().toISOString() }).eq("id", rid);
        const providerNotConfigured = sendError instanceof Error &&
          sendError.message === "RECOVERY_EMAIL_PROVIDER_NOT_CONFIGURED";
        const smtpConfigurationInvalid = sendError instanceof Error &&
          sendError.message === "RECOVERY_SMTP_CONFIGURATION_INVALID";
        console.error("[recuperar-contrasena] SMTP delivery failed", {
          reason: providerNotConfigured ? "NOT_CONFIGURED" :
            smtpConfigurationInvalid ? "INVALID_CONFIGURATION" : "SMTP_REJECTED",
        });
        if (providerNotConfigured) {
          return reply({ error: "RECOVERY_EMAIL_PROVIDER_NOT_CONFIGURED" }, 503);
        }
        if (smtpConfigurationInvalid) {
          return reply({ error: "RECOVERY_SMTP_CONFIGURATION_INVALID" }, 503);
        }
        return reply({ error: "RECOVERY_EMAIL_UNAVAILABLE" }, 502);
      }
      return reply({ accepted: true }, 202);
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
      if (userError || !userData.user?.id) return invalidRecovery();

      const { data: request, error: requestError } = await admin
        .from("password_recovery_requests")
        .select("id, token_hash, profile_id, contact_email, expires_at, consumed_at, mail_auth_user_id, shadow_user_created_by_recovery")
        .eq("id", rid).maybeSingle();
      if (requestError || !request || request.consumed_at ||
          new Date(request.expires_at).getTime() <= Date.now()) return invalidRecovery();
      if (await tokenHash(rawToken) !== request.token_hash ||
          userData.user.id !== request.profile_id ||
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
      return reply({ success: true }, 200);
    }

    return reply({ error: "Modo de recuperación no válido." }, 400);
  } catch (_error) {
    console.error("[recuperar-contrasena] unexpected recovery failure");
    return reply({ error: "RECOVERY_SERVICE_UNAVAILABLE" }, 503);
  }
});