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
        lista.replaceChildren();
        return;
    }

    const { data, error } = await client
        .from('sugerencias')
        .select('id, mensaje, creado_en, leida, respuesta, respuesta_en, respuesta_vista')
        .eq('usuario_id', usuarioId)
        .order('creado_en', { ascending: false });

    if (error) {
        console.error(error);
        lista.replaceChildren();
        return;
    }
    if (!data || data.length === 0) {
        const empty = document.createElement('p');
        empty.style.opacity = '0.8';
        empty.textContent = 'Todavía no mandaste ninguna sugerencia.';
        lista.replaceChildren(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    data.forEach(s => {
        const fecha = new Date(s.creado_en).toLocaleString('es', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const card = document.createElement('div');
        card.className = 'sugerencia-card';

        const meta = document.createElement('div');
        meta.className = 'sugerencia-card-meta';
        const date = document.createElement('span');
        date.textContent = fecha;
        const status = document.createElement('span');
        status.textContent = s.leida ? '✅ Leída por el admin' : '⏳ Pendiente de leer';
        meta.appendChild(date);
        meta.appendChild(status);

        const message = document.createElement('p');
        message.textContent = String(s.mensaje || '');
        card.appendChild(meta);
        card.appendChild(message);

        if (s.respuesta) {
            const response = document.createElement('div');
            response.className = 'sugerencia-respuesta';
            const title = document.createElement('strong');
            title.textContent = 'Respuesta del admin:';
            const text = document.createElement('p');
            text.textContent = String(s.respuesta);
            response.appendChild(title);
            response.appendChild(text);
            card.appendChild(response);
        }
        fragment.appendChild(card);
    });
    lista.replaceChildren(fragment);

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
