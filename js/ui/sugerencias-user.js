/**
 * CuevaCoin — js/ui/sugerencias-user.js
 * Lista de sugerencias de la trabajadora (Oleada 4).
 * No incluye respuestas admin ni realtime de admin.
 */

export async function loadUserSugerencias(usuarioId) {
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    const lista = document.getElementById('user-sugerencias-lista');
    if (!lista) return;
    if (!client) {
        lista.innerHTML = '';
        return;
    }

    const { data, error } = await client
        .from('sugerencias')
        .select('id, mensaje, creado_en, leida, respuesta, respuesta_en, respuesta_vista')
        .eq('usuario_id', usuarioId)
        .order('creado_en', { ascending: false });

    if (error) {
        console.error(error);
        lista.innerHTML = '';
        return;
    }
    if (!data || data.length === 0) {
        lista.innerHTML = '<p style="opacity: 0.8;">Todavía no mandaste ninguna sugerencia.</p>';
        return;
    }
    lista.innerHTML = data.map(s => {
        const fecha = new Date(s.creado_en).toLocaleString('es', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const bloqueRespuesta = s.respuesta ? `
                    <div class="sugerencia-respuesta">
                        <strong>Respuesta del admin:</strong>
                        <p>${s.respuesta}</p>
                    </div>
                ` : '';
        return `
                    <div class="sugerencia-card">
                        <div class="sugerencia-card-meta">
                            <span>${fecha}</span>
                            <span>${s.leida ? '✅ Leída por el admin' : '⏳ Pendiente de leer'}</span>
                        </div>
                        <p>${s.mensaje}</p>
                        ${bloqueRespuesta}
                    </div>
                `;
    }).join('');

    const idsSinVer = data.filter(s => s.respuesta && !s.respuesta_vista).map(s => s.id);
    const actualizarDot = (typeof window !== 'undefined' && window.actualizarBonosDot)
        ? window.actualizarBonosDot : async () => {};
    if (idsSinVer.length > 0) {
        client.from('sugerencias').update({ respuesta_vista: true }).in('id', idsSinVer)
            .then(({ error: errorVista }) => {
                if (errorVista) console.error(errorVista);
                actualizarDot(false);
            });
    } else {
        actualizarDot(false);
    }
}

if (typeof window !== 'undefined') {
    window.loadUserSugerencias = loadUserSugerencias;
}
