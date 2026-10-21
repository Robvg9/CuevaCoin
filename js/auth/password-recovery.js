/* CuevaCoin V145 — recovery uses only the email's «Restablecer contraseña» button. */
(() => {
  const byId = (id) => document.getElementById(id);
  const clean = (value) => String(value || "").trim();
  const params = () => new URLSearchParams(window.location.search || "");
  let linkMode = params().get("cc_recovery") === "1";
  let linkSessionReady = false;
  let authListenerRegistered = false;

  function setMessage(message, error = false) {
    const el = byId("recuperar-contrasena-mensaje");
    if (!el) return;
    el.textContent = message;
    el.style.color = error ? "#b91c1c" : "var(--text-color)";
    el.setAttribute("role", error ? "alert" : "status");
  }

  function clearRecoveryUrl() {
    try { window.history.replaceState({}, document.title, window.location.pathname); } catch (_) {}
  }

  async function callRecovery(payload, needsSession = false) {
    const base = window.SUPABASE_URL;
    const key = window.SUPABASE_KEY;
    if (!base || !key) throw new Error("RECOVERY_CLIENT_NOT_READY");
    const headers = { apikey: key, "Content-Type": "application/json" };
    if (needsSession) {
      const client = window.supabaseClient;
      if (!client) throw new Error("RECOVERY_SESSION_NOT_READY");
      const { data, error } = await client.auth.getSession();
      if (error || !data?.session?.access_token) {
        const noSession = new Error("RECOVERY_SESSION_MISSING");
        noSession.status = 401;
        throw noSession;
      }
      headers.Authorization = "Bearer " + data.session.access_token;
    }
    const response = await fetch(base + "/functions/v1/recuperar-contrasena", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || "RECOVERY_REQUEST_FAILED");
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function setLinkUi() {
    const panel = byId("recuperar-contrasena-panel");
    const requestForm = byId("form-solicitar-recuperacion");
    const completeForm = byId("form-confirmar-recuperacion");
    if (!panel || !requestForm || !completeForm) return;
    panel.classList.remove("hidden");
    requestForm.classList.add("hidden");
    completeForm.classList.remove("hidden");
    const submit = byId("btn-confirmar-recuperacion");
    if (submit) submit.textContent = "Guardar nueva contraseña";
    setMessage("Enlace de recuperación abierto. Establece una contraseña nueva para esta cuenta.");
    const client = window.supabaseClient;
    if (client && !authListenerRegistered) {
      authListenerRegistered = true;
      client.auth.onAuthStateChange((event, session) => {
        if (linkMode && session?.access_token) {
          linkSessionReady = true;
          setMessage("Enlace reconocido. Introduce y confirma tu nueva contraseña.");
        }
      });
    }
    if (client) {
      client.auth.getSession().then(({ data, error }) => {
        if (!error && data?.session?.access_token) {
          linkSessionReady = true;
          setMessage("Enlace reconocido. Introduce y confirma tu nueva contraseña.");
        } else {
          setMessage("Esperando que se valide el enlace seguro de recuperación…");
        }
      }).catch(() => setMessage("No se pudo validar el enlace. Solicita uno nuevo.", true));
    }
    byId("recuperar-nueva-contrasena")?.focus({ preventScroll: true });
  }

  function openRecoveryLink() {
    linkMode = true;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", setLinkUi, { once: true });
    } else {
      setLinkUi();
    }
  }
  if (typeof window !== "undefined") window.abrirRecuperacionPorEnlace = openRecoveryLink;

  function install() {
    const openButton = byId("btn-olvido-contrasena");
    const panel = byId("recuperar-contrasena-panel");
    const requestForm = byId("form-solicitar-recuperacion");
    const completeForm = byId("form-confirmar-recuperacion");
    const cancelButton = byId("btn-cancelar-recuperacion");
    const usernameInput = byId("username");
    if (!openButton || !panel || !requestForm || !completeForm || !usernameInput ||
        openButton.dataset.recoveryBound === "1") return;
    openButton.dataset.recoveryBound = "1";

    openButton.addEventListener("click", () => {
      panel.classList.remove("hidden");
      requestForm.classList.remove("hidden");
      completeForm.classList.add("hidden");
      linkMode = false;
      setMessage("");
      const requestButton = byId("btn-enviar-enlace-recuperacion");
      if (requestButton) requestButton.disabled = false;
      if (usernameInput.value.trim()) {
        setMessage("Usaremos el usuario o correo que escribiste arriba.");
      } else {
        setMessage("Escribe primero tu usuario o correo en el campo del inicio de sesión.");
        usernameInput.focus();
      }
    });

    requestForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const identifier = clean(usernameInput.value);
      const button = byId("btn-enviar-enlace-recuperacion");
      if (!identifier || identifier.length > 120) {
        setMessage("Escribe un usuario o correo válido en el campo del inicio de sesión.", true);
        usernameInput.focus();
        return;
      }
      if (button) {
        button.disabled = true;
        button.textContent = "Solicitando…";
      }
      setMessage("Solicitando recuperación…");
      try {
        await callRecovery({ mode: "request", identifier });
        setMessage("Si la cuenta está activa y el envío está configurado, recibirás un correo. Abre únicamente el botón «Restablecer contraseña» del mensaje para elegir tu nueva contraseña. Revisa también Spam.");
      } catch (error) {
        if (error.status === 429) {
          setMessage("Demasiados intentos. Espera unos minutos antes de solicitar otra recuperación.", true);
        } else if (error.message === "RECOVERY_EMAIL_PROVIDER_NOT_CONFIGURED") {
          setMessage("Falta configurar el remitente SMTP del servidor. No se cambió ninguna contraseña.", true);
        } else if (error.message === "RECOVERY_SMTP_CONFIGURATION_INVALID") {
          setMessage("La configuración SMTP del servidor es inválida. No se cambió ninguna contraseña.", true);
        } else if (error.status === 502) {
          setMessage("El servidor SMTP rechazó el envío. No se cambió ninguna contraseña; revisa la configuración del remitente.", true);
        } else {
          setMessage("No se pudo iniciar la recuperación. Comprueba la conexión e inténtalo de nuevo.", true);
        }
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = "Enviar correo de restablecimiento";
        }
      }
    });

    completeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = byId("recuperar-nueva-contrasena")?.value || "";
      const confirm = byId("recuperar-confirmar-contrasena")?.value || "";
      const button = byId("btn-confirmar-recuperacion");
      if (password.length < 8 || password.length > 128) {
        setMessage("La nueva contraseña debe tener entre 8 y 128 caracteres.", true);
        byId("recuperar-nueva-contrasena")?.focus();
        return;
      }
      if (password !== confirm) {
        setMessage("Las dos contraseñas no coinciden.", true);
        byId("recuperar-confirmar-contrasena")?.focus();
        return;
      }
      if (linkMode && !linkSessionReady) {
        setMessage("El enlace aún no está validado o ha expirado. Solicita una recuperación nueva.", true);
        return;
      }
      if (!linkMode || !params().get("rid") || !params().get("rt") || !linkSessionReady) {
        setMessage("Abre el botón «Restablecer contraseña» del correo para validar la recuperación.", true);
        return;
      }
      if (button) {
        button.disabled = true;
        button.textContent = "Actualizando…";
      }
      setMessage("Verificando recuperación y actualizando contraseña…");
      try {
        const query = params();
        await callRecovery({
          mode: "complete-link",
          rid: query.get("rid"),
          token: query.get("rt"),
          newPassword: password,
        }, true);
        requestForm.classList.add("hidden");
        completeForm.classList.add("hidden");
        setMessage("Contraseña restablecida. Ya puedes iniciar sesión con tu usuario o correo y la nueva contraseña.");
        if (byId("password")) byId("password").value = "";
        byId("recuperar-nueva-contrasena").value = "";
        byId("recuperar-confirmar-contrasena").value = "";
        if (linkMode) {
          try { await window.supabaseClient.auth.signOut(); } catch (_) {}
          clearRecoveryUrl();
          linkMode = false;
          linkSessionReady = false;
        }
      } catch (error) {
        if (error.status === 429) {
          setMessage("Demasiados intentos. Espera y vuelve a solicitar una recuperación nueva.", true);
        } else if (error.status === 502 || error.status === 503) {
          setMessage("El servicio de recuperación no está disponible. No se cambió la contraseña; inténtalo más tarde.", true);
        } else {
          setMessage("El botón de recuperación expiró o ya fue utilizado, o la cuenta no está disponible. Solicita un correo nuevo.", true);
        }
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = "Restablecer contraseña";
        }
      }
    });

    cancelButton?.addEventListener("click", async () => {
      if (linkMode) {
        try { await window.supabaseClient?.auth.signOut(); } catch (_) {}
        clearRecoveryUrl();
        linkMode = false;
        linkSessionReady = false;
      }
      panel.classList.add("hidden");
      requestForm.classList.remove("hidden");
      completeForm.classList.add("hidden");
      requestForm.reset();
      completeForm.reset();
      setMessage("");
    });

    if (linkMode || params().get("cc_recovery") === "1") openRecoveryLink();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();