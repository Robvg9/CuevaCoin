import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_ORIGIN = "https://cuevacoin.robvg9.workers.dev";
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_IP = 12;
const attempts = new Map<string, { count: number; resetAt: number }>();

const headers = {
  "Access-Control-Allow-Headers": "apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Vary": "Origin",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Access-Control-Allow-Origin": APP_ORIGIN },
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
function clearAttempts(ip: string) { attempts.delete(ip); }
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
function genericFailure(status = 401) {
  return reply({ error: "LOGIN_INVALID" }, status);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin !== APP_ORIGIN) return reply({ error: "Origen no permitido." }, 403);
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204, headers: { ...headers, "Access-Control-Allow-Origin": APP_ORIGIN },
  });
  if (req.method !== "POST") return reply({ error: "Método no permitido." }, 405);

  const ip = clientIp(req);
  if (!allowAttempt(ip)) return genericFailure(429);

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 4096) return genericFailure(400);

  let body: { identifier?: unknown; password?: unknown };
  try { body = await req.json(); } catch { return genericFailure(400); }
  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!identifier || identifier.length > 120 || !password || password.length > 256 ||
      /[\r\n\0]/.test(identifier)) return genericFailure(401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRole) {
    return reply({ error: "LOGIN_SERVICE_UNAVAILABLE" }, 503);
  }

  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(url, serviceRole, options);
  const auth = createClient(url, anonKey, options);
  const dummyEmail = "no-such-cuevacoin-user@cuevacoin.local";

  try {
    // Public login identifier is either perfiles.usuario or the contact email in perfiles.correo.
    // The internal Auth email is resolved server-side and never exposed as a lookup result.
    const column = identifier.includes("@") ? "correo" : "usuario";
    const { data: profile, error: profileError } = await admin
      .from("perfiles")
      .select("id, estado")
      .ilike(column, escapeLike(identifier))
      .maybeSingle();

    if (profileError) {
      console.error("[cuevacoin-login] profile lookup failed");
      return reply({ error: "LOGIN_SERVICE_UNAVAILABLE" }, 503);
    }

    let internalAuthEmail = dummyEmail;
    let eligible = false;
    if (profile?.estado === "activo") {
      const { data: authUser, error: getUserError } = await admin.auth.admin.getUserById(profile.id);
      if (getUserError) {
        console.error("[cuevacoin-login] Auth UUID lookup failed");
        return reply({ error: "LOGIN_SERVICE_UNAVAILABLE" }, 503);
      }
      if (authUser?.user?.email) {
        internalAuthEmail = authUser.user.email;
        eligible = true;
      }
    }

    // Use Supabase Auth's real password verifier; never compare or store passwords in application data.
    const { data: loginData, error: loginError } = await auth.auth.signInWithPassword({
      email: internalAuthEmail,
      password,
    });
    if (!eligible || loginError || !loginData.session || loginData.user?.id !== profile?.id) {
      return genericFailure(401);
    }

    clearAttempts(ip);
    return reply({ session: loginData.session }, 200);
  } catch (_error) {
    console.error("[cuevacoin-login] unexpected login handler failure");
    return reply({ error: "LOGIN_SERVICE_UNAVAILABLE" }, 503);
  }
});