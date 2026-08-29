/** Fase 3 / Oleada 8 — loadAdminStats */

export async function loadAdminStats() {
    const { data: perfiles, error: errorPerfiles } = await window.supabaseClient
        .from('perfiles')
        .select('saldo')
        .eq('es_admin', false);
    if (errorPerfiles) console.error(errorPerfiles);

    const { count: totalSolicitudesPendientes, error: errorSolicitudes } = await window.supabaseClient
        .from('solicitudes_retiro')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'pendiente');
    if (errorSolicitudes) console.error(errorSolicitudes);

    const inicioHoy = new Date();
    inicioHoy.setHours(0, 0, 0, 0);
    const { count: totalTransferenciasHoy, error: errorTransferencias } = await window.supabaseClient
        .from('transacciones')
        .select('id', { count: 'exact', head: true })
        .eq('tipo', 'transferencia')
        .gte('creado_en', inicioHoy.toISOString());
    if (errorTransferencias) console.error(errorTransferencias);

    const totalUsuarios = perfiles ? perfiles.length : 0;
    const saldoTotal = perfiles ? perfiles.reduce((total, p) => total + Number(p.saldo), 0) : 0;

    document.getElementById('total-usuarios').textContent = totalUsuarios;
    // Tanda v77: todos los montos de la app son enteros (retiros/
    // depósitos/transferencias no admiten decimales, ver
    // esMontoEnteroValido), así que el ".00" del saldo total nunca
    // aportaba información - solo ocupaba espacio y empujaba el
    // desborde en pantallas chicas. Se saca y se agrega separador
    // de miles para que se lea mejor con montos grandes.
    document.getElementById('total-saldo').textContent = `$${Math.round(saldoTotal).toLocaleString('es-PR')}`;
    document.getElementById('solicitudes-pendientes').textContent = totalSolicitudesPendientes ?? 0;
    document.getElementById('transferencias-hoy').textContent = totalTransferenciasHoy ?? 0;

    // B6 (2026-08-06): punto de aviso en "Solicitudes de Retiro" del
    // sidebar cuando hay al menos una solicitud pendiente - antes esa
    // opción no tenía ningún indicador visual de novedad.
    const dotSolicitudes = document.getElementById('solicitudes-retiro-dot');
    if (dotSolicitudes) dotSolicitudes.classList.toggle('hidden', !(totalSolicitudesPendientes > 0));
}

if (typeof window !== 'undefined') {
    window.loadAdminStats = loadAdminStats;
}
