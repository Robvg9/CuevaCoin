import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Secure password recovery for CuevaCoin's username@cuevacoin.local Auth model.
 * The recovery email comes from perfiles.correo; no email or user-existence detail
 * is returned to the public client. An OTP proves mailbox control before a password
 * is changed for the profile's original Auth UUID.
 */
const APP_ORIGIN = "https://cuevacoin.robvg9.workers.dev";
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_IP = 6;
const attempts = new Map<string, { count: number; resetAt: number }>();

const corsHeaders = {
  "Access-Control-Allow-Headers": "apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Vary": "Origin",
};

function reply(body: unknown, status = 200, origin = APP_ORIGIN) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Access-Control-Allow-Origin": origin },
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
    for (const [key, value] of attempts) {
      if (value.resetAt <= now) attempts.delete(key);
    }
  }
  return old.count <= MAX_ATTEMPTS_PER_IP;
}

function cleanIdentifier(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 121) : "";
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function genericInvalid() {
  return reply({ error: "RECOVERY_INVALID" }, 400);
}

async function findActiveProfile(admin: ReturnType<typeof createClient>, identifier: string) {
  if (!identifier || identifier.length > 120 || /[\r\n\0]/.test(identifier)) return null;
  const isEmail = identifier.includes("@");
  const column = isEmail ? "correo" : "usuario";
  const { data, error } = await admin
    .from("perfiles")
    .select("id, usuario, correo, estado")
    .ilike(column, escapeLike(identifier))
    .maybeSingle();
  if (error) {
    console.error("[recuperar-contrasena] profile lookup failed");
    throw new Error("PROFILE_LOOKUP_FAILED");
  }
  if (!data || data.estado !== "activo" ||
      typeof data.correo !== "string" ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.correo.trim())) {
    return null;
  }
  return { id: data.id as string, correo: data.correo.trim() as string };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin !== APP_ORIGIN) return reply({ error: "Origen no permitido." }, 403, APP_ORIGIN);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...corsHeaders, "Access-Control-Allow-Origin": APP_ORIGIN } });
  if (req.method !== "POST") return reply({ error: "Método no permitido." }, 405);

  const ip = clientIp(req);
  if (!allowAttempt(ip)) {
    return reply({ error: "Demasiados intentos. Espera un rato y vuelve a probar." }, 429);
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 4096) return reply({ error: "Solicitud inválida." }, 400);

  let body: { identifier?: unknown; mode?: unknown; code?: unknown; newPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Solicitud inválida." }, 400);
  }

  const identifier = cleanIdentifier(body.identifier);
  if (!identifier || identifier.length > 120) return reply({ error: "Solicitud inválida." }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRole) {
    return reply({ error: "Servicio de recuperación temporalmente no disponible." }, 503);
  }

  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(url, serviceRole, options);
  const publicAuth = createClient(url, anonKey, options);

  try {
    const profile = await findActiveProfile(admin, identifier);

    if (body.mode === "request") {
      // Always answer generically for missing, inactive, archived, or eligible profiles.
      if (profile) {
        const { error } = await publicAuth.auth.signInWithOtp({
          email: profile.correo,
          options: { shouldCreateUser: true },
        });
        if (error) {
          // Do not reveal whether the account exists; Supabase's own OTP limit still applies.
          console.warn("[recuperar-contrasena] OTP request did not complete");
          if (error.status === 429 || /rate.?limit/i.test(error.message || "")) {
            return reply({ error: "Demasiados intentos. Espera un rato y vuelve a probar." }, 429);
          }
        }
      }
      return reply({ accepted: true });
    }

    if (body.mode === "complete") {
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
      if (!profile || !/^\d{6}$/.test(code) || newPassword.length < 8 || newPassword.length > 128) {
        return genericInvalid();
      }

      // Validate OTP in an isolated, non-persistent client. Its temporary session is never returned.
      const { data: verified, error: verifyError } = await publicAuth.auth.verifyOtp({
        email: profile.correo,
        token: code,
        type: "email",
      });
      if (verifyError || !verified.user ||
          verified.user.email?.trim().toLowerCase() !== profile.correo.toLowerCase()) {
        return genericInvalid();
      }

      // Re-read status immediately before the privileged write; archiving after OTP request cancels recovery.
      const current = await findActiveProfile(admin, identifier);
      if (!current || current.id !== profile.id ||
          current.correo.toLowerCase() !== profile.correo.toLowerCase()) {
        return genericInvalid();
      }

      const { error: updateError } = await admin.auth.admin.updateUserById(current.id, {
        password: newPassword,
      });
      if (updateError) {
        console.error("[recuperar-contrasena] Auth password update failed");
        return reply({ error: "No se pudo completar la recuperación. Inténtalo de nuevo." }, 500);
      }
      return reply({ success: true });
    }

    return reply({ error: "Modo de recuperación no válido." }, 400);
  } catch (_error) {
    return reply({ error: "No se pudo completar la recuperación. Comprueba la conexión e inténtalo de nuevo." }, 503);
  }
});