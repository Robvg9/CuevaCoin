/**
 * CuevaCoin — js/finance/queue/offline-queue.js
 * Fase 3 / Oleada 2 — Cola offline + helpers de persistencia.
 * Copia 1:1 desde legacy. NO cablear todavía.
 */

export function actualizarIndicadorColaPendiente() {
    const cola = window.obtenerColaPendiente();
    const link = document.getElementById('conexion-strip-sync-link');

    // Sin conexión: la franja roja debe verse SIEMPRE, haya o no
    // cambios en la cola. Antes esta función cortaba de una si la
    // cola estaba vacía y la franja roja nunca llegaba a mostrarse.
    if (!navigator.onLine) {
        if (link) link.classList.add('hidden');
        const mensaje = cola.length > 0
            ? `📴 Sin conexión — ${cola.length} cambio(s) esperando para sincronizarse`
            : '📴 Sin conexión a Internet';
        window.mostrarConexionStrip('offline', mensaje, null);
        return;
    }

    if (cola.length === 0) {
        if (link) link.classList.add('hidden');

        // No dejar fija una franja roja de un intento anterior cuando la
        // cola está vacía y Supabase ya responde. navigator.onLine por sí
        // solo no demuestra que haya Internet real, por eso se verifica el
        // backend antes de retirar el aviso.
        const strip = document.getElementById('conexion-strip');
        const mensajeActual = document.getElementById('conexion-strip-texto')?.textContent || '';
        const pareceAvisoOffline = strip?.classList.contains('conexion-strip--offline')
            && /sin conexión|no pudimos conectar|no se pudo conectar/i.test(mensajeActual);
        if (pareceAvisoOffline && typeof window.hayConexionRealAhora === 'function') {
            window.hayConexionRealAhora().then((confirmada) => {
                if (!confirmada || window.obtenerColaPendiente().length > 0) return;
                const stripActual = document.getElementById('conexion-strip');
                const mensaje = document.getElementById('conexion-strip-texto')?.textContent || '';
                if (stripActual?.classList.contains('conexion-strip--offline')
                    && /sin conexión|no pudimos conectar|no se pudo conectar/i.test(mensaje)
                    && typeof window.ocultarConexionStrip === 'function') {
                    window.ocultarConexionStrip();
                }
            }).catch(() => {});
        }
        return;
    }

    if (link) link.classList.remove('hidden');
    window.mostrarConexionStrip('online', `📥 Tienes ${cola.length} cambio(s) sin sincronizar`, null);
}

export function obtenerColaPendiente() {
    try {
        return JSON.parse(localStorage.getItem(window.CLAVE_COLA_PENDIENTE)) || [];
    } catch (e) {
        return [];
    }
}

export function guardarColaPendiente(cola) {
    localStorage.setItem(window.CLAVE_COLA_PENDIENTE, JSON.stringify(cola));
}

export function encolarAccion(tipo, datos) {
    const cola = window.obtenerColaPendiente();
    const item = {
        id: 'cola-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        tipo: tipo,
        datos: datos,
        creado_en: new Date().toISOString()
    };
    cola.push(item);
    window.guardarColaPendiente(cola);
    window.showToast('📥 Guardado en tu dispositivo. Se sincronizará cuando tengas internet', 4000);
    window.actualizarIndicadorColaPendiente();
    return item;
}

/** Error de negocio permanente: reintentar no cambiará el resultado. */
function esErrorPermanenteDeCola(err) {
    const msg = ((err && (err.message || err.name || err.code || '')) + '').toLowerCase();
    if (!msg) return false;
    return /saldo.?insuficiente|insufficient|retiro_pendiente_existente|ya tienes un retiro pendiente|idempotency_key_conflict|idempotency_key_replay|correo.?inexistente|usuario.?no.?encontrado|destinatario.?no|no.?encontrad|no autorizado|unauthorized|forbidden|permiso|inválid|invalid|tipo de acción encolada desconocido|monto.?inválid/.test(msg);
}

/** Límite de reintentos para fallos transitorios (evita loop infinito). */
const MAX_INTENTOS_COLA = 8;

export async function sincronizarColaPendiente() {
    if (sincronizandoColaEnCurso || !navigator.onLine) return;
    const cola = window.obtenerColaPendiente();
    if (cola.length === 0) return;
    sincronizandoColaEnCurso = true;
    window.showToast(`🔄 Sincronizando ${cola.length} cambio(s) pendiente(s)...`, 3000);

    const sincronizados = [];
    const fallidosPermanentes = [];
    const fallidosTransitorios = [];
    const colaActualizada = [];

    for (const item of cola) {
        try {
            await window.ejecutarAccionDeCola(item);
            sincronizados.push(item);
        } catch (err) {
            console.error('No se pudo sincronizar la acción encolada', item, err);
            const mensaje = (err && err.message) ? err.message : 'Error desconocido';
            const permanente = esErrorPermanenteDeCola(err);
            const transitorio = !permanente && (
                (typeof window.esErrorDeConexion === 'function' && window.esErrorDeConexion(err))
                || /timeout|fetch|network|Load failed|Failed to fetch|ERR_NETWORK|ERR_INTERNET|503|502|504|429/i.test(mensaje)
                || !navigator.onLine
            );

            if (permanente) {
                fallidosPermanentes.push({ item: item, mensaje: mensaje });
                // no se reencola
            } else if (transitorio) {
                const intentos = (item.intentos || 0) + 1;
                if (intentos >= MAX_INTENTOS_COLA) {
                    fallidosPermanentes.push({
                        item: item,
                        mensaje: mensaje + ' (se agotaron los reintentos)'
                    });
                } else {
                    colaActualizada.push(Object.assign({}, item, {
                        intentos: intentos,
                        ultimo_error: mensaje,
                        ultimo_intento_en: new Date().toISOString()
                    }));
                    fallidosTransitorios.push({ item: item, mensaje: mensaje, intentos: intentos });
                }
            } else {
                // Error no clasificado: conservar (más seguro que descartar)
                const intentos = (item.intentos || 0) + 1;
                if (intentos >= MAX_INTENTOS_COLA) {
                    fallidosPermanentes.push({
                        item: item,
                        mensaje: mensaje + ' (se agotaron los reintentos)'
                    });
                } else {
                    colaActualizada.push(Object.assign({}, item, {
                        intentos: intentos,
                        ultimo_error: mensaje,
                        ultimo_intento_en: new Date().toISOString()
                    }));
                    fallidosTransitorios.push({ item: item, mensaje: mensaje, intentos: intentos });
                }
            }
        }
    }

    // Éxito y permanentes salen de la cola; transitorios permanecen con intentos++
    window.guardarColaPendiente(colaActualizada);
    sincronizandoColaEnCurso = false;
    window.actualizarIndicadorColaPendiente();

    if (sincronizados.length > 0) {
        window.showToast(`✅ ${sincronizados.length} cambio(s) pendiente(s) ya se sincronizaron`, 4000);
        if (typeof recargarSeccionActual === 'function') {
            recargarSeccionActual();
        }
    }
    fallidosPermanentes.forEach(f => {
        window.showToast(`⚠️ No se pudo aplicar un cambio guardado: ${f.mensaje}. Se eliminó de la cola — tendrás que intentarlo de nuevo.`, 6000);
    });
    if (fallidosTransitorios.length > 0) {
        window.showToast(`⏳ ${fallidosTransitorios.length} cambio(s) no se pudieron sincronizar (red/temporal). Se conservan para reintentar.`, 5000);
    }
}

export async function ejecutarAccionDeCola(item) {
    if (item.tipo === 'perfil') {
        const { error } = await window.supabaseClient
            .from('perfiles')
            .update(item.datos.cambios)
            .eq('id', item.datos.usuarioId);
        if (error) throw error;
        return;
    }
    if (item.tipo === 'retiro') {
        // BUG #1: RPC atómica solicitar_retiro (mismo camino online/offline)
        // Key estable: la de la cola o, en items viejos, una derivada de item.id (nunca Date.now en retry)
        const keyCola = item.datos.idempotency_key || ('cola-item-' + item.id);
        const { data, error } = await window.supabaseClient.rpc('solicitar_retiro', {
            p_cantidad: item.datos.cantidad,
            p_motivo: item.datos.motivo || 'Solicitud de retiro',
            p_idempotency_key: keyCola
        });
        if (error) {
            const msg = (error.message || '') + ' ' + (error.details || '') + ' ' + (error.hint || '') + ' ' + (error.code || '');
            if (/saldo.?insuficiente|insufficient/i.test(msg)) throw new Error('Saldo insuficiente');
            if (/retiro_pendiente_existente|ya tienes un retiro pendiente/i.test(msg)) {
                throw new Error('Ya tienes un retiro pendiente. Espera a que el admin lo resuelva.');
            }
            if (/idempotency_key_conflict/i.test(msg)) {
                if (typeof window.limpiarRetiroIdempotencyKey === 'function') window.limpiarRetiroIdempotencyKey();
                throw new Error('idempotency_key_conflict');
            }
            if (/idempotency_key_replay/i.test(msg)) {
                if (typeof window.limpiarRetiroIdempotencyKey === 'function') window.limpiarRetiroIdempotencyKey();
                throw new Error('idempotency_key_replay');
            }
            if (/permission denied|42501|not authorized|JWT|expired|PGRST301/i.test(msg)) {
                throw new Error('No autorizado para retirar. Vuelve a iniciar sesión.');
            }
            throw error;
        }
        const fila = Array.isArray(data) ? data[0] : data;
        if (fila && fila.error) {
            if (fila.error === 'saldo_insuficiente') throw new Error('Saldo insuficiente');
            if (fila.error === 'retiro_pendiente_existente') {
                throw new Error('Ya tienes un retiro pendiente. Espera a que el admin lo resuelva.');
            }
            if (fila.error === 'idempotency_key_conflict' || fila.error === 'idempotency_key_replay') {
                if (typeof window.limpiarRetiroIdempotencyKey === 'function') window.limpiarRetiroIdempotencyKey();
                throw new Error(fila.error);
            }
            throw new Error(fila.error);
        }
        // Éxito solo con solicitud_id real (no marcar sincronizado si el backend no creó nada)
        if (!fila || !fila.solicitud_id) {
            console.error('solicitar_retiro (cola) sin solicitud_id:', { data: data, keyCola: keyCola });
            throw new Error('La solicitud de retiro no se registró en el servidor');
        }
        // Reflejar saldo reservado en sesión + cache + UI (misma regla que online)
        try {
            const bruto = (fila.nuevo_saldo != null) ? fila.nuevo_saldo
                : (fila.nuevoSaldo != null ? fila.nuevoSaldo : null);
            let usuarioCola = null;
            try {
                usuarioCola = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
            } catch (eSes) { usuarioCola = null; }
            if (usuarioCola && usuarioCola.id) {
                const saldoAntes = Number(usuarioCola.saldo);
                const cant = Number(item.datos.cantidad) || 0;
                const esperado = (!Number.isNaN(saldoAntes) ? saldoAntes : 0) - cant;
                let nuevoSaldo;
                if (bruto != null && !Number.isNaN(Number(bruto))) {
                    nuevoSaldo = Number(bruto);
                    if (cant > 0 && nuevoSaldo > esperado + 0.0001) {
                        nuevoSaldo = esperado;
                    }
                } else {
                    nuevoSaldo = esperado;
                }
                if (nuevoSaldo < 0) nuevoSaldo = 0;
                usuarioCola.saldo = nuevoSaldo;
                sessionStorage.setItem('cuevacoin_usuario_actual', JSON.stringify(usuarioCola));
                try {
                    localStorage.setItem('cuevacoin_perfil_cache', JSON.stringify(usuarioCola));
                } catch (eCache) {}
                const saldoSpan = document.getElementById('user-saldo');
                if (saldoSpan) saldoSpan.textContent = Number(nuevoSaldo).toFixed(2);
                const perfilSaldoSpan = document.getElementById('perfil-saldo');
                if (perfilSaldoSpan) perfilSaldoSpan.textContent = Number(nuevoSaldo).toFixed(2);
                if (typeof window.actualizarMetaAhorroInicio === 'function') {
                    try { window.actualizarMetaAhorroInicio(usuarioCola); } catch (eMeta) {}
                }
                if (typeof window.pintarRetiroPendienteUI === 'function') {
                    try { window.pintarRetiroPendienteUI(item.datos.cantidad); } catch (ePend) {}
                } else if (typeof window.actualizarRetiroPendienteUI === 'function') {
                    try { window.actualizarRetiroPendienteUI(usuarioCola.id); } catch (ePend2) {}
                }
            }
        } catch (eSaldoCola) {
            console.error('No se pudo reflejar saldo tras retiro en cola:', eSaldoCola);
        }

        // Notificar admin (dedup por solicitud_id); el saldo ya lo reservó la RPC
        try {
            const { data: adminRetiroCola } = await window.supabaseClient
                .from('perfiles')
                .select('id')
                .eq('es_admin', true)
                .limit(1)
                .maybeSingle();
            if (adminRetiroCola) {
                const nombre = (item.datos.nombre_usuario) || 'Trabajadora';
                const mensaje = `${nombre} solicitó un retiro de $${item.datos.cantidad}`;
                await window.notificarAdminRetiroSiNoDuplicado(fila.solicitud_id, mensaje, adminRetiroCola.id);
            }
        } catch (eNotifCola) {
            console.error('Notif admin retiro cola (no bloquea):', eNotifCola);
        }
        return;
    }
    if (item.tipo === 'transferir') {
        // Misma key que se generó al encolar (o fallback estable para ítems viejos)
        const idempotencyKey = item.datos.idempotencyKey
            || item.datos.idempotency_key
            || ('cola-item-' + item.id);
        // New queue items store recipient IDs; old email-only items remain replayable.
        const destinatario = item.datos.destinatarioId
            ? { destinatarioId: item.datos.destinatarioId }
            : (item.datos.destinatarioCorreo
                ? { destinatarioCorreo: item.datos.destinatarioCorreo }
                : null);
        if (!destinatario) throw new Error('La transferencia pendiente no tiene un destinatario válido.');
        const { data, error } = await window.supabaseClient.functions.invoke('transferir-saldo', {
            body: {
                ...destinatario,
                cantidad: item.datos.cantidad,
                motivo: item.datos.motivo,
                idempotencyKey: idempotencyKey
            }
        });
        if (error || data?.error) {
            throw new Error(await window.extraerMensajeErrorEdgeFunction(error, data));
        }
        return;
    }
    throw new Error('Tipo de acción encolada desconocido: ' + item.tipo);
}

if (typeof window !== 'undefined') {
    window.actualizarIndicadorColaPendiente = actualizarIndicadorColaPendiente;
    window.obtenerColaPendiente = obtenerColaPendiente;
    window.guardarColaPendiente = guardarColaPendiente;
    window.encolarAccion = encolarAccion;
    window.sincronizarColaPendiente = sincronizarColaPendiente;
    window.ejecutarAccionDeCola = ejecutarAccionDeCola;
}
