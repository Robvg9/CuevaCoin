/* CuevaCoin — recuperación segura de contraseña desde el login. */
(() => {
  const byId = (id) => document.getElementById(id);
  const clean = (value) => String(value || "").trim();

  function setMessage(message, error = false) {
    const el = byId("recuperar-contrasena-mensaje");
    if (!el) return;
    el.textContent = message;
    el.style.color = error ? "#b91c1c" : "var(--text-color)";
    el.setAttribute("role", error ? "alert" : "status");
  }

  async function callRecovery(payload) {
    const base = window.SUPABASE_URL;
    const key = window.SUPABASE_KEY;
    if (!base || !key) throw new Error("RECOVERY_CLIENT_NOT_READY");
    const response = await fetch(base + "/functions/v1/recuperar-contrasena", {
      method: "POST",
      headers: {
        apikey: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || "RECOVERY_REQUEST_FAILED");
      error.status = response.status;
      throw error;
    }
    return result;
  }

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
      setMessage("");
      const requestButton = byId("btn-enviar-codigo-recuperacion");
      const completeButton = byId("btn-confirmar-recuperacion");
      if (requestButton) requestButton.disabled = false;
      if (completeButton) completeButton.disabled = false;
      if (usernameInput.value.trim()) {
        setMessage("Se usará el usuario o correo que escribiste arriba. Solicita un código para continuar.");
      } else {
        setMessage("Escribe primero tu usuario o correo en el campo del inicio de sesión.");
        usernameInput.focus();
      }
    });

    requestForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const identifier = clean(usernameInput.value);
      const button = byId("btn-enviar-codigo-recuperacion");
      if (!identifier) {
        setMessage("Escribe tu usuario o correo en el campo del inicio de sesión.", true);
        usernameInput.focus();
        return;
      }
      if (identifier.length > 120) {
        setMessage("El usuario o correo es demasiado largo.", true);
        return;
      }
      if (button) {
        button.disabled = true;
        button.textContent = "Solicitando código…";
      }
      setMessage("Solicitando código de recuperación…");
      try {
        await callRecovery({ mode: "request", identifier });
        completeForm.classList.remove("hidden");
        setMessage("Si la cuenta está activa y tiene un correo asociado, enviaremos un código. Revisa también spam y escribe el código recibido junto con tu nueva contraseña.");
        byId("recuperar-codigo")?.focus();
      } catch (error) {
        if (error.status === 429) {
          setMessage("Demasiados intentos. Espera un rato antes de solicitar otro código.", true);
        } else {
          setMessage("No se pudo procesar la solicitud. Comprueba la conexión e inténtalo de nuevo.", true);
        }
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = "Enviar código de recuperación";
        }
      }
    });

    completeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const identifier = clean(usernameInput.value);
      const code = clean(byId("recuperar-codigo")?.value);
      const password = byId("recuperar-nueva-contrasena")?.value || "";
      const confirm = byId("recuperar-confirmar-contrasena")?.value || "";
      const button = byId("btn-confirmar-recuperacion");
      if (!/^\d{6}$/.test(code)) {
        setMessage("Introduce el código de seis dígitos que recibiste por correo.", true);
        byId("recuperar-codigo")?.focus();
        return;
      }
      if (password.length < 8) {
        setMessage("La nueva contraseña debe tener al menos 8 caracteres.", true);
        byId("recuperar-nueva-contrasena")?.focus();
        return;
      }
      if (password !== confirm) {
        setMessage("Las dos contraseñas no coinciden.", true);
        byId("recuperar-confirmar-contrasena")?.focus();
        return;
      }
      if (button) {
        button.disabled = true;
        button.textContent = "Actualizando contraseña…";
      }
      setMessage("Verificando el código y actualizando la contraseña…");
      try {
        await callRecovery({
          mode: "complete",
          identifier,
          code,
          newPassword: password,
        });
        requestForm.classList.add("hidden");
        completeForm.classList.add("hidden");
        setMessage("Contraseña restablecida. Ya puedes iniciar sesión con tu usuario y la nueva contraseña.");
        byId("btn-olvido-contrasena")?.focus();
        if (byId("password")) byId("password").value = "";
        byId("recuperar-codigo").value = "";
        byId("recuperar-nueva-contrasena").value = "";
        byId("recuperar-confirmar-contrasena").value = "";
      } catch (error) {
        if (error.status === 429) {
          setMessage("Demasiados intentos. Espera un rato y solicita un código nuevo si es necesario.", true);
        } else {
          setMessage("Código inválido o vencido, cuenta no disponible o error temporal. Comprueba el código y vuelve a intentarlo.", true);
        }
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = "Restablecer contraseña";
        }
      }
    });

    cancelButton?.addEventListener("click", () => {
      panel.classList.add("hidden");
      requestForm.classList.remove("hidden");
      completeForm.classList.add("hidden");
      requestForm.reset();
      completeForm.reset();
      setMessage("");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();