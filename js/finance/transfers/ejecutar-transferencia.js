/** Fase 3 / Oleada 4 — ejecutarTransferencia */

export async function ejecutarTransferencia(destinatarioCorreo, cantidad, motivo) {
    // Punto 36c: no se puede validar destinatario/saldo real sin
    // internet (RLS no deja leer el perfil de otro trabajador desde
    // el cliente), así que se encola tal cual y esa validación
    // completa la hace la Edge Function al sincronizar.
    if (!navigator.onLine) {
        window.encolarAccion('transferir', { destinatarioCorreo: destinatarioCorreo, cantidad: cantidad, motivo: motivo });
        window.closeModal('transferir-modal');
        document.getElementById('transferir-form').reset();
        window.transferenciaViaQR = false;
        return;
    }

    // El saldo, la validación de "no transferirte a ti mismo", que el
    // correo exista y que el destinatario esté verificado se validan
    // en el servidor (Edge Function "transferir-saldo" con
    // service_role), no aquí en el cliente, porque un trabajador no
    // puede leer el perfil de otro por RLS.
    const { data, error } = await window.supabaseClient.functions.invoke('transferir-saldo', {
        body: { destinatarioCorreo, cantidad, motivo }
    });

    if (error || data?.error) {
        console.error(error || data.error);
        window.showToast(await window.extraerMensajeErrorEdgeFunction(error, data), 4000);
        window.closeModal('transferir-modal');
        window.transferenciaViaQR = false;
        return;
    }

    // Reflejar el nuevo saldo (el que confirma el servidor) en la sesión y la UI
    const usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));
    usuario.saldo = data.nuevoSaldo;
    sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuario));
    document.getElementById('user-saldo').textContent = data.nuevoSaldo.toFixed(2);
    document.getElementById('perfil-saldo').textContent = data.nuevoSaldo.toFixed(2);

    window.showToast(`Transferencia de $${cantidad.toFixed(2)} enviada`, 3000);
    window.closeModal('transferir-modal');
    document.getElementById('transferir-form').reset();
    window.transferenciaViaQR = false;

    // Punto 43: revisar si esta transferencia desbloqueó el chat
    // privado con esta persona por primera vez, y felicitar.
    verificarPrimeraTransferenciaYFelicitar(usuario.id);
}

if (typeof window !== 'undefined') {
    window.ejecutarTransferencia = ejecutarTransferencia;
}
