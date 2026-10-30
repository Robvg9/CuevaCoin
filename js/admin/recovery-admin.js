/* CuevaCoin V146 — administrator queue for one-time password recovery codes. */
(() => {
  const $ = (id) => document.getElementById(id);
  const queue = () => $("admin-recovery-request-cards");
  const empty = () => $("admin-recovery-empty");

  async function callAdminRecovery(payload) {
    const client = window.supabaseClient;
    if (!client || !window.SUPABASE_URL || !window.SUPABASE_KEY) {
      throw new Error("RECOVERY_CLIENT_NOT_READY");
    }
    const { data, error } = await client.auth.getSession();
    const accessToken = data?.session?.access_token;
    if (error || !accessToken) throw new Error("ADMIN_SESSION_REQUIRED");

    const response = await fetch(window.SUPABASE_URL + "/functions/v1/recuperar-contrasena", {
      method: "POST",
      headers: {
        apikey: window.SUPABASE_KEY,
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(20000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || "RECOVERY_REQUEST_FAILED");
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function makeText(tag, text, style) {
    const el = document.createElement(tag);
    el.textContent = text;
    if (style) el.style.cssText = style;
    return el;
  }

  function makeCodePanel(code, expiresAt) {
    const panel = document.createElement("div");
    panel.style.cssText = "margin-top:14px;padding:14px;border:1px solid var(--success-color,#16a34a);border-radius:12px;background:var(--bg-secondary,rgba(22,163,74,.06));";
    panel.appendChild(makeText("p", "CÓDIGO DE UN SOLO USO — entrégalo directamente a la trabajadora.", "font-weight:700;margin:0 0 8px;"));
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;";
    const input = document.createElement("input");
    input.type = "text";
    input.readOnly = true;
    input.value = code;
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Código temporal de recuperación");
    input.style.cssText = "flex:1;min-width:180px;font-size:19px;letter-spacing:2px;font-weight:800;text-align:center;";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn btn-primary";
    copy.textContent = "Copiar código";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code);
        copy.textContent = "Copiado";
      } catch (_) {
        input.focus();
        input.select();
        try { document.execCommand("copy"); copy.textContent = "Copiado"; }
        catch (_) { copy.textContent = "Selecciona y copia"; }
      }
    });
    row.append(input, copy);
    panel.appendChild(row);
    panel.appendChild(makeText("p", "Vence: " + new Date(expiresAt).toLocaleString() + ". El código se invalida después del primer uso o de cinco intentos fallidos.", "font-size:12px;opacity:.8;margin:10px 0 0;"));
    return panel;
  }

  async function loadAdminRecoveryRequests() {
    const target = queue();
    const emptyMessage = empty();
    if (!target) return;
    target.replaceChildren(makeText("p", "Cargando solicitudes…", "opacity:.75;"));
    if (emptyMessage) emptyMessage.classList.add("hidden");
    try {
      const result = await callAdminRecovery({ mode: "admin-list" });
      const rows = Array.isArray(result.requests) ? result.requests : [];
      target.replaceChildren();
      if (!rows.length) {
        if (emptyMessage) emptyMessage.classList.remove("hidden");
        const dot = $("recuperacion-pendiente-dot");
        if (dot) dot.classList.add("hidden");
        return;
      }
      const pendingCount = rows.filter((item) => item.status === "pending").length;
      const dot = $("recuperacion-pendiente-dot");
      if (dot) {
        dot.textContent = pendingCount ? String(pendingCount) : "";
        dot.classList.toggle("hidden", pendingCount === 0);
      }
      rows.forEach((item) => {
        const card = document.createElement("div");
        card.className = "card";
        card.style.cssText = "margin:12px 0;padding:14px;";
        card.appendChild(makeText("h3", item.name || item.username, "margin:0 0 5px;"));
        card.appendChild(makeText("p", "Usuario: " + item.username, "margin:3px 0;"));
        card.appendChild(makeText("p", "Solicitud: " + new Date(item.created_at).toLocaleString(), "font-size:12px;opacity:.75;margin:3px 0 10px;"));
        const activeCode = item.status === "issued" && item.code_expires_at && new Date(item.code_expires_at).getTime() > Date.now();
        const statusLine = activeCode
          ? "Código emitido. Vence: " + new Date(item.code_expires_at).toLocaleString()
          : item.status === "pending" ? "Pendiente de aprobación." : "El código anterior venció; puedes emitir otro.";
        card.appendChild(makeText("p", statusLine, "font-weight:600;margin:6px 0 10px;"));
        const issue = document.createElement("button");
        issue.type = "button";
        issue.className = "btn btn-primary";
        issue.textContent = activeCode ? "Código ya emitido" : item.status === "pending" ? "Generar código (15 min)" : "Emitir nuevo código";
        issue.disabled = !!activeCode;
        issue.addEventListener("click", async () => {
          if (item.status === "issued" && !confirm("El código anterior ya venció. ¿Generar uno nuevo?")) return;
          issue.disabled = true;
          issue.textContent = "Generando…";
          try {
            const issued = await callAdminRecovery({ mode: "admin-issue", rid: item.id });
            issue.textContent = "Código generado";
            card.appendChild(makeCodePanel(issued.code, issued.expires_at));
            const status = card.querySelector("p:last-of-type");
            if (status) status.textContent = "Código emitido. Entrégalo a la trabajadora por un canal privado.";
            const dot = $("recuperacion-pendiente-dot");
            if (dot) dot.classList.add("hidden");
          } catch (error) {
            issue.disabled = false;
            issue.textContent = "Reintentar";
            window.showToast?.(error.message === "RECOVERY_CODE_ALREADY_ACTIVE"
              ? "Ya existe un código vigente para esta solicitud."
              : "No se pudo generar el código. Actualiza la lista e inténtalo de nuevo.", 4500);
          }
        });
        card.appendChild(issue);
        target.appendChild(card);
      });
    } catch (error) {
      target.replaceChildren(makeText("p", "No se pudieron cargar las solicitudes. Comprueba que tu sesión de administrador sigue activa.", "color:var(--error-color,#b91c1c);"));
      console.error("[CuevaCoin admin recovery]", error);
    }
  }

  function install() {
    const refresh = $("btn-refresh-admin-recovery");
    if (refresh && refresh.dataset.bound !== "1") {
      refresh.dataset.bound = "1";
      refresh.addEventListener("click", loadAdminRecoveryRequests);
    }
  }

  window.loadAdminRecoveryRequests = loadAdminRecoveryRequests;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
