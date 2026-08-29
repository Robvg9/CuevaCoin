/**
 * CuevaCoin — js/admin/sugerencias-admin.js
 * Buzón de sugerencias (lado admin) — Oleada 6.
 * Contenido/comunicaciones; no mueve saldo ni retiros.
 */

export const RESPUESTAS_RAPIDAS_SUGERENCIAS = [
    'Gracias por tu sugerencia, la tendremos en cuenta.',
    'Ya la estamos revisando, gracias por avisar.',
    'Buena idea, la vamos a implementar pronto.',
    '¡Gracias! Ya se solucionó, prueba de nuevo.'
];


export async function loadAdminSugerencias() {
    const { data, error } = await window.supabaseClient
        .from('sugerencias')
        .select('id, mensaje, leida, creado_en, usuario_id, respuesta, respuesta_en, perfiles(nombre, usuario)')
        .order('creado_en', { ascending: false });

    const lista = document.getElementById('admin-sugerencias-lista');
    const vacioMsg = document.getElementById('admin-sugerencias-vacio');

    if (error) {
        console.error(error);
        lista.innerHTML = '';
        vacioMsg.textContent = 'No se pudieron cargar las sugerencias.';
        vacioMsg.classList.remove('hidden');
        return;
    }

    if (!data || data.length === 0) {
        lista.innerHTML = '';
        vacioMsg.textContent = 'Todavía no llegó ninguna sugerencia.';
        vacioMsg.classList.remove('hidden');
        return;
    }
    vacioMsg.classList.add('hidden');

    lista.innerHTML = data.map(s => {
        const fecha = new Date(s.creado_en).toLocaleString('es', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const nombre = s.perfiles?.nombre || s.perfiles?.usuario || 'Trabajadora';
        // E11/E2 (v62): buzón con respuesta. Si ya tiene respuesta,
        // se muestra como referencia (con botón para editarla/volver
        // a mandar); si no, se muestra el formulario de respuesta
        // directo (con las plantillas rápidas arriba del textarea).
        const bloqueRespuesta = s.respuesta
            ? `
                <div class="sugerencia-respuesta">
                    <strong>Tu respuesta:</strong>
                    <p>${s.respuesta}</p>
                    <button type="button" class="btn" style="margin-top: 6px;" onclick="mostrarFormRespuestaSugerencia('${s.id}')">Editar respuesta</button>
                </div>
                <div class="sugerencia-respuesta-form hidden" id="form-respuesta-${s.id}">
                    ${respuestasRapidasHtml(s.id)}
                    <textarea id="respuesta-texto-${s.id}" rows="3" maxlength="500">${s.respuesta}</textarea>
                    <button type="button" class="btn btn-primary" style="margin-top: 6px;" onclick="enviarRespuestaSugerencia('${s.id}')">Guardar respuesta</button>
                </div>
            `
            : `
                <button type="button" class="btn" style="margin-top: 8px;" onclick="mostrarFormRespuestaSugerencia('${s.id}')">Responder</button>
                <div class="sugerencia-respuesta-form hidden" id="form-respuesta-${s.id}">
                    ${respuestasRapidasHtml(s.id)}
                    <textarea id="respuesta-texto-${s.id}" rows="3" maxlength="500" placeholder="Escribe la respuesta para ${nombre}..."></textarea>
                    <button type="button" class="btn btn-primary" style="margin-top: 6px;" onclick="enviarRespuestaSugerencia('${s.id}')">Enviar respuesta</button>
                </div>
            `;
        return `
            <div class="sugerencia-card ${s.leida ? '' : 'no-leida'}">
                <div class="sugerencia-card-meta">
                    <strong>${nombre}</strong>
                    <span>${fecha}</span>
                </div>
                <p>${s.mensaje}</p>
                ${!s.leida ? `<button type="button" class="btn" style="margin-top: 8px;" onclick="marcarSugerenciaLeida('${s.id}')">Marcar como leída</button>` : ''}
                ${bloqueRespuesta}
            </div>
        `;
    }).join('');
}

export function respuestasRapidasHtml(sugerenciaId) {
    return `
        <div class="respuestas-rapidas">
            ${RESPUESTAS_RAPIDAS_SUGERENCIAS.map(texto => `
                <button type="button" class="respuesta-rapida-chip" onclick="aplicarRespuestaRapida('${sugerenciaId}', this)" data-texto="${texto.replace(/"/g, '"')}">${texto}</button>
            `).join('')}
        </div>
    `;
}


export function mostrarFormRespuestaSugerencia(sugerenciaId) {
    const form = document.getElementById(`form-respuesta-${sugerenciaId}`);
    if (form) form.classList.toggle('hidden');
}


export function aplicarRespuestaRapida(sugerenciaId, boton) {
    const textarea = document.getElementById(`respuesta-texto-${sugerenciaId}`);
    if (textarea) textarea.value = boton.dataset.texto;
}


export async function enviarRespuestaSugerencia(sugerenciaId) {
    if (!window.requiereConexionParaOperar()) return;
    const textarea = document.getElementById(`respuesta-texto-${sugerenciaId}`);
    const respuesta = textarea.value.trim();
    if (!respuesta) {
        window.showToast('Escribe una respuesta antes de enviar', 3000);
        return;
    }

    // Se guarda la respuesta, se marca leída de paso (si el admin
    // respondió es porque ya la leyó) y se resetea respuesta_vista
    // a false para que le vuelva a aparecer como novedad a la
    // trabajadora aunque ya hubiera visto una respuesta anterior.
    const { data: sugerencia, error } = await window.supabaseClient
        .from('sugerencias')
        .update({ respuesta, respuesta_en: new Date().toISOString(), respuesta_vista: false, leida: true })
        .eq('id', sugerenciaId)
        .select('usuario_id')
        .single();
    if (error) {
        console.error(error);
        window.showToast('No se pudo guardar la respuesta', 3000);
        return;
    }

    // Avisar a la trabajadora (mismo patrón que sendUserMessage/A1).
    const mensajeNotif = 'El admin respondió tu sugerencia en Bonos';
    const { error: errorNotif } = await window.supabaseClient.from('notificaciones').insert({
        usuario_id: sugerencia.usuario_id,
        mensaje: mensajeNotif,
        leida: false,
        tipo_evento: 'sugerencia'
    });
    if (errorNotif) console.error(errorNotif);
    window.supabaseClient.functions.invoke('enviar-push', {
        body: { usuario_id: sugerencia.usuario_id, mensaje: mensajeNotif, tipo_evento: 'sugerencia' }
    }).catch((err) => console.error('Error mandando push de respuesta de sugerencia:', err));

    window.showToast('Respuesta enviada', 2500);
    window.loadAdminSugerencias();
    window.actualizarBonosDot(true);
}

export async function marcarSugerenciaLeida(sugerenciaId) {
    const { error } = await window.supabaseClient.from('sugerencias').update({ leida: true }).eq('id', sugerenciaId);
    if (error) {
        console.error(error);
        window.showToast('No se pudo marcar como leída', 3000);
        return;
    }
    window.loadAdminSugerencias();
    window.actualizarBonosDot(true);
}

if (typeof window !== 'undefined') {
    window.RESPUESTAS_RAPIDAS_SUGERENCIAS = RESPUESTAS_RAPIDAS_SUGERENCIAS;
    window.loadAdminSugerencias = loadAdminSugerencias;
    window.respuestasRapidasHtml = respuestasRapidasHtml;
    window.mostrarFormRespuestaSugerencia = mostrarFormRespuestaSugerencia;
    window.aplicarRespuestaRapida = aplicarRespuestaRapida;
    window.enviarRespuestaSugerencia = enviarRespuestaSugerencia;
    window.marcarSugerenciaLeida = marcarSugerenciaLeida;
}
