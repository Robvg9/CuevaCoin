const BC_URL = "https://papxnkkjtkxsitcsvcme.supabase.co";
const BC_ANON_KEY = "sb_publishable_pczHaS1JDPGrEA31vdbOLg_1l2qFhbm";
const ALLOWED_ORIGINS = new Set(["https://battlecruiser.robvg9.workers.dev","https://bc-pr-224-battlecruiser.robvg9.workers.dev","https://ux-jornada-status-colors-transfer-modern-picker-battlecruiser.robvg9.workers.dev"]);
function corsHeaders(origin: string | null): HeadersInit {
  return { "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "null", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "600", "Vary": "Origin", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
}
function response(status: number, body: Record<string, unknown>, origin: string | null): Response { return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) }); }
function fail(message: string, status = 400, origin: string | null = null): Response { return response(status, { ok: false, error: message }, origin); }
function requiredEnv(name: string): string { const value = Deno.env.get(name); if (!value) throw new Error("Falta configurar el servicio interno de CuevaCoin."); return value; }
async function fetchJson(url: string, init: RequestInit): Promise<any> {
  const result = await fetch(url, init); const raw = await result.text(); let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = { message: raw.slice(0, 500) }; }
  if (!result.ok) { const error = new Error(String(data?.message || data?.error_description || data?.error || "No se pudo completar la operación.")); (error as any).status = result.status; throw error; }
  return data;
}
async function bcRequest(path: string, token: string, body?: unknown): Promise<any> {
  return fetchJson(BC_URL + path, { method: body === undefined ? "GET" : "POST", headers: { "apikey": BC_ANON_KEY, "Authorization": "Bearer " + token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function ccRequest(path: string, body?: unknown): Promise<any> {
  const url = requiredEnv("SUPABASE_URL"); const service = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return fetchJson(url + path, { method: body === undefined ? "GET" : "POST", headers: { "apikey": service, "Authorization": "Bearer " + service, ...(body === undefined ? {} : { "Content-Type": "application/json" }), "Prefer": "return=representation" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function verifyOwner(token: string): Promise<{ id: string }> {
  const user = await bcRequest("/auth/v1/user", token); if (!user?.id) throw new Error("La sesión de BattleCruiser no es válida.");
  await bcRequest("/rest/v1/rpc/bc7_payroll_assert_admin", token, {}); return { id: String(user.id) };
}
async function getCcAdminId(): Promise<string> {
  const rows = await ccRequest("/rest/v1/perfiles?select=id&es_admin=eq.true&estado=eq.activo&limit=2");
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.id) throw new Error("CuevaCoin debe tener exactamente un administrador activo para registrar nómina.");
  return String(rows[0].id);
}
async function getActiveDependent(profileId: string): Promise<any> {
  const rows = await ccRequest("/rest/v1/perfiles?select=id,nombre,usuario,es_dependiente,es_admin,estado&id=eq." + encodeURIComponent(profileId) + "&es_dependiente=eq.true&es_admin=eq.false&estado=eq.activo&limit=1");
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("La cuenta elegida no es una dependiente activa de CuevaCoin."); return rows[0];
}
type PayrollPayload = { usuarioId: string; tipo: "DEPOSITO" | "RETIRO"; cantidad: number; motivo: string; key: string; reference: string };
async function callCcPayroll(payload: PayrollPayload): Promise<any> {
  const adminId = await getCcAdminId();
  return ccRequest("/rest/v1/rpc/admin_operar_nomina_integrado", { p_admin_id: adminId, p_usuario_id: payload.usuarioId, p_tipo: payload.tipo, p_cantidad: payload.cantidad, p_motivo: payload.motivo, p_idempotency_key: payload.key, p_referencia_externa: payload.reference });
}
async function setBcRetry(token: string, kind: "credit" | "withdrawal", id: string, message: string): Promise<void> {
  const name = kind === "credit" ? "bc7_payroll_retry_credit" : "bc7_payroll_retry_withdrawal";
  const args = kind === "credit" ? { p_salary_id: id, p_error: message.slice(0, 500) } : { p_gasto_id: id, p_error: message.slice(0, 500) };
  try { await bcRequest("/rest/v1/rpc/" + name, token, args); } catch (_) { /* operation remains reconcilable with its original idempotency key */ }
}
async function creditSalary(token: string, salaryId: string): Promise<any> {
  const prepared = await bcRequest("/rest/v1/rpc/bc7_payroll_begin_credit", token, { p_salary_id: salaryId });
  if (prepared?.ya_pagado) return { ok: true, ya_pagado: true, id: salaryId, transaccion_id: prepared.transaccion_id };
  try {
    const result = await callCcPayroll({ usuarioId: String(prepared.cc_perfil_id), tipo: "DEPOSITO", cantidad: Number(prepared.monto), motivo: String(prepared.motivo), key: String(prepared.idempotency_key), reference: String(prepared.referencia_externa) });
    const finalized = await bcRequest("/rest/v1/rpc/bc7_payroll_finish_credit", token, { p_salary_id: salaryId, p_cc_transaccion_id: result.transaccion_id });
    return { ok: true, ...result, battlecruiser: finalized };
  } catch (error) { await setBcRetry(token, "credit", salaryId, String((error as any)?.message || error)); throw error; }
}
async function withdrawSalary(token: string, expenseId: string): Promise<any> {
  const prepared = await bcRequest("/rest/v1/rpc/bc7_payroll_begin_withdrawal", token, { p_gasto_id: expenseId });
  if (prepared?.ya_aplicado) return { ok: true, ya_aplicado: true, id: expenseId, transaccion_id: prepared.transaccion_id };
  try {
    const result = await callCcPayroll({ usuarioId: String(prepared.cc_perfil_id), tipo: "RETIRO", cantidad: Number(prepared.monto), motivo: String(prepared.motivo), key: String(prepared.idempotency_key), reference: String(prepared.referencia_externa) });
    const finalized = await bcRequest("/rest/v1/rpc/bc7_payroll_finish_withdrawal", token, { p_gasto_id: expenseId, p_cc_transaccion_id: result.transaccion_id });
    return { ok: true, ...result, battlecruiser: finalized };
  } catch (error) { await setBcRetry(token, "withdrawal", expenseId, String((error as any)?.message || error)); throw error; }
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return fail("Método no permitido.", 405, origin);
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return fail("Origen no autorizado.", 403, origin);
  const match = (req.headers.get("authorization") || "").match(/^Bearer\s+(\S+)$/i);
  if (!match) return fail("Se requiere la sesión de BattleCruiser.", 401, origin);
  let body: any; try { body = await req.json(); } catch (_) { return fail("Solicitud JSON inválida.", 400, origin); }
  if (!body || typeof body.action !== "string") return fail("Acción inválida.", 400, origin);
  try {
    await verifyOwner(match[1]);
    switch (body.action) {
      case "list_dependents": {
        const rows = await ccRequest("/rest/v1/perfiles?select=id,nombre,usuario,es_dependiente,estado&es_dependiente=eq.true&es_admin=eq.false&estado=eq.activo&order=nombre.asc");
        return response(200, { ok: true, dependents: rows }, origin);
      }
      case "save_mapping": {
        const bcId = String(body.bc_usuario_id || ""); const ccId = String(body.cc_perfil_id || "");
        if (!bcId || !ccId) return fail("Selecciona ambas cuentas antes de guardar el vínculo.", 400, origin);
        await getActiveDependent(ccId);
        const saved = await bcRequest("/rest/v1/rpc/bc7_payroll_set_mapping", match[1], { p_bc_usuario_id: bcId, p_cc_perfil_id: ccId });
        return response(200, { ok: true, mapping: saved }, origin);
      }
      case "credit_salary": { const id = String(body.salary_id || ""); if (!id) return fail("Falta el identificador del salario.", 400, origin); return response(200, await creditSalary(match[1], id), origin); }
      case "withdraw_salary": { const id = String(body.expense_id || ""); if (!id) return fail("Falta el identificador del gasto salarial.", 400, origin); return response(200, await withdrawSalary(match[1], id), origin); }
      case "set_mode": {
        if (!["MANUAL", "AUTOMATICO"].includes(body.mode)) return fail("Modo inválido.", 400, origin);
        const saved = await bcRequest("/rest/v1/rpc/bc7_payroll_set_mode", match[1], { p_modo: body.mode });
        return response(200, { ok: true, settings: saved }, origin);
      }
      case "process_automatic": {
        const settings = await bcRequest("/rest/v1/rpc/bc7_payroll_get_settings", match[1], {});
        if (settings?.modo_pago !== "AUTOMATICO") return response(200, { ok: true, skipped: true, reason: "MANUAL" }, origin);
        const salaries = await bcRequest("/rest/v1/rpc/bc7_payroll_list_salaries", match[1], {});
        const ready = (Array.isArray(salaries) ? salaries : []).filter((x: any) => x.estado === "LISTO_PARA_PAGO" && x.cc_vinculado);
        const results: any[] = [];
        for (const salary of ready) { try { results.push(await creditSalary(match[1], String(salary.id))); } catch (error) { results.push({ ok: false, id: salary.id, error: String((error as any)?.message || error) }); } }
        return response(200, { ok: results.every((x: any) => x.ok), processed: results.length, results }, origin);
      }
      default: return fail("Acción no reconocida.", 400, origin);
    }
  } catch (error) {
    const status = Number((error as any)?.status || 400); const safeStatus = status === 401 ? 401 : status === 403 ? 403 : status >= 500 ? 502 : 400;
    return fail(String((error as any)?.message || "No se pudo completar la operación."), safeStatus, origin);
  }
});