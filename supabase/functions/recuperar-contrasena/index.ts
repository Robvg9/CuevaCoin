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

  let body: { identifier?: unknown; mode?: unknown; newPassword?: unknown; rid?: unknown; token?: unknown };
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