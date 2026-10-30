/* CuevaCoin V146 — worker flow for administrator-issued password recovery codes. */
(() => {
  const $ = (id) => document.getElementById(id);
  const clean = (value) => String(value || "").trim();

  async function request(payload) {
    if (!window.SUPABASE_URL || !window.SUPABASE_KEY) throw new Error("RECOVERY_CLIENT_NOT_READY");
    const response = await fetch(window.SUPABASE_URL + "/functions/v1/recuperar-contrasena", {
      method: "POST",
      headers: { apikey: window.SUPABASE_KEY, "Content-Type": "application/json" },
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

  function message(text, isError = false) {
    const el = $("recuperar-admin-mensaje");
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? "#b91c1c" : "var(--text-color)";
    el.setAttribute("role", isError ? "alert" : "status");
  }

  function showAdminRequest() {
    $("form-solicitar-recuperacion")?.classList.add("hidden");
    $("form-confirmar-recuperacion")?.classList.add("hidden");
    $("form-solicitar-recuperacion-admin")?.classList.remove("hidden");
    $("form-confirmar-recuperacion-admin")?.classList.add("hidden");
    $("btn-mostrar-recuperacion-admin")?.classList.add("hidden");
    $("btn-ya-tengo-codigo")?.classList.remove("hidden");
    message("Escribe tu usuario en el campo de inicio de sesión. La solicitud aparecerá en la cuenta del administrador; no se enviará ningún SMS.");
  }

  function showAdminCodeEntry() {
    $("form-solicitar-recuperacion-admin")?.classList.add("hidden");
    $("form-confirmar-recuperacion-admin")?.classList.remove("hidden");
    $("btn-ya-tengo-codigo")?.classList.add("hidden");
    $("recuperar-codigo-admin")?.focus();
    message("Introduce tu usuario, el código que te entregó el administrador y tu nueva contraseña. El código vence a los 15 minutos y solo se usa una vez.");
  }

  function resetAdminUi() {
    $("form-solicitar-recuperacion-admin")?.classList.add("hidden");
    $("form-confirmar-recuperacion-admin")?.classList.add("hidden");
    $("btn-ya-tengo-codigo")?.classList.add("hidden");
    $("btn-mostrar-recuperacion-admin")?.classList.remove("hidden");
    $("form-solicitar-recuperacion")?.classList.remove("hidden");
    $("form-confirmar-recuperacion")?.classList.add("hidden");
    $("form-solicitar-recuperacion-admin")?.reset();
    $("form-confirmar-recuperacion-admin")?.reset();
    message("");
  }

  function install() {
    const toggle = $("btn-mostrar-recuperacion-admin");
    const requestForm = $("form-solicitar-recuperacion-admin");
    const confirmForm = $("form-confirmar-recuperacion-admin");
    const haveCode = $("btn-ya-tengo-codigo");
    const backEmail = $("btn-volver-recuperacion-correo");
    const cancel = $("btn-cancelar-recuperacion");
    const open = $("btn-olvido-contrasena");
    const username = $("username");

    toggle?.addEventListener("click", showAdminRequest);
    haveCode?.addEventListener("click", showAdminCodeEntry);
    backEmail?.addEventListener("click", resetAdminUi);
    cancel?.addEventListener("click", resetAdminUi);
    open?.addEventListener("click", resetAdminUi);

    requestForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const identifier = clean(username?.value);
      const button = $("btn-solicitar-codigo-admin");
      if (!identifier || identifier.length > 120) {
        message("Escribe primero tu usuario en el campo de inicio de sesión.", true);
        username?.focus();
        return;
      }
      if (button) { button.disabled = true; button.textContent = "Registrando solicitud…"; }
      try {
        await request({ mode: "admin-request", identifier });
        message("Solicitud registrada. El administrador debe revisarla y entregarte un código. Cuando lo recibas, pulsa «Ya tengo un código». Si la cuenta no está disponible, no se revelará información.");
      } catch (error) {
        message(error.status === 429
          ? "Has alcanzado el límite de solicitudes. Contacta directamente al administrador."
          : "No se pudo registrar la solicitud. Comprueba tu conexión e inténtalo de nuevo.", true);
      } finally {
        if (button) { button.disabled = false; button.textContent = "Enviar solicitud al administrador"; }
      }
    });

    confirmForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const identifier = clean(username?.value);
      const code = clean($("recuperar-codigo-admin")?.value).toUpperCase().replace(/[\s-]/g, "");
      const password = $("recuperar-admin-nueva-contrasena")?.value || "";
      const confirmPassword = $("recuperar-admin-confirmar-contrasena")?.value || "";
      const button = $("btn-confirmar-recuperacion-admin");
      if (!identifier) { message("Escribe el usuario de la cuenta que vas a recuperar.", true); username?.focus(); return; }
      if (!/^[A-HJ-NP-Z2-9]{16}$/.test(code)) { message("El código debe tener 16 caracteres. Revisa que esté completo.", true); $("recuperar-codigo-admin")?.focus(); return; }
      if (password.length < 8 || password.length > 128) { message("La nueva contraseña debe tener entre 8 y 128 caracteres.", true); $("recuperar-admin-nueva-contrasena")?.focus(); return; }
      if (password !== confirmPassword) { message("Las dos contraseñas no coinciden.", true); $("recuperar-admin-confirmar-contrasena")?.focus(); return; }
      if (button) { button.disabled = true; button.textContent = "Verificando código…"; }
      message("Validando el código y actualizando la cuenta…");
      try {
        await request({ mode: "admin-complete", identifier, code, newPassword: password });
        confirmForm.reset();
        if ($("password")) $("password").value = "";
        $("form-solicitar-recuperacion-admin")?.classList.add("hidden");
        confirmForm.classList.add("hidden");
        haveCode?.classList.add("hidden");
        message("Contraseña restablecida correctamente. Ya puedes iniciar sesión con tu usuario y la nueva contraseña.");
      } catch (error) {
        if (error.status === 429) message("Demasiados intentos. Contacta al administrador para solicitar otro código.", true);
        else if (error.status === 503) message("El servicio de recuperación no está disponible ahora. No se completó la operación; inténtalo más tarde.", true);
        else message("Código incorrecto, vencido, ya utilizado o no corresponde a este usuario. Comprueba los datos o solicita otro código.", true);
      } finally {
        if (button) { button.disabled = false; button.textContent = "Restablecer contraseña"; }
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
