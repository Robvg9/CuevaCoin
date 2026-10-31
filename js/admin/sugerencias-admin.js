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

function crearElementoSugerencia(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value != null) element.textContent = String(value);
    return element;
}

function crearAccionSugerencia(label, className, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
}

function crearRespuestasRapidas(sugerenciaId, textarea) {
    const wrapper = document.createElement('div');
    wrapper.className = 'respuestas-rapidas';
    RESPUESTAS_RAPIDAS_SUGERENCIAS.forEach(texto => {
        const button = crearAccionSugerencia(texto, 'respuesta-rapida-chip', () => {
            textarea.value = texto;
        });
        button.dataset.texto = texto;
        wrapper.appendChild(button);
    });
    return wrapper;
}

export async function loadAdminSugerencias() {
    const { data, error } = await window.supabaseClient
        .from('sugerencias')
        .select('id, mensaje, leida, creado_en, usuario_id, respuesta, respuesta_en, perfiles(nombre, usuario)')
        .order('creado_en', { ascending: false });

    const lista = document.getElementById('admin-sugerencias-lista');
    const vacioMsg = document.getElementById('admin-sugerencias-vacio');
    if (!lista || !vacioMsg) return;

    if (error) {
        console.error(error);
        lista.replaceChildren();
        vacioMsg.textContent = 'No se pudieron cargar las sugerencias.';
        vacioMsg.classList.remove('hidden');
        return;
    }

    lista.replaceChildren();
    if (!data || data.length === 0) {
        vacioMsg.textContent = 'Todavía no llegó ninguna sugerencia.';
        vacioMsg.classList.remove('hidden');
        return;
    }
    vacioMsg.classList.add('hidden');

    data.forEach(s => {
        const fecha = new Date(s.creado_en).toLocaleString('es', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const nombre = s.perfiles?.nombre || s.perfiles?.usuario || 'Trabajadora';
        const sugerenciaId = String(s.id);

        const card = document.createElement('div');
        card.className = 'sugerencia-card' + (s.leida ? '' : ' no-leida');

        const meta = document.createElement('div');
        meta.className = 'sugerencia-card-meta';
        meta.appendChild(crearElementoSugerencia('strong', '', nombre));
        meta.appendChild(crearElementoSugerencia('span', '', fecha));
        card.appendChild(meta);
        card.appendChild(crearElementoSugerencia('p', '', s.mensaje || ''));

        if (!s.leida) {
            card.appendChild(crearAccionSugerencia('Marcar como leída', 'btn', () => {
                marcarSugerenciaLeida(sugerenciaId);
            }));
        }

        const form = document.createElement('div');
        form.className = 'sugerencia-respuesta-form hidden';
        form.id = 'form-respuesta-' + sugerenciaId;

        const textarea = document.createElement('textarea');
        textarea.id = 'respuesta-texto-' + sugerenciaId;
        textarea.rows = 3;
        textarea.maxLength = 500;
        textarea.value = s.respuesta == null ? '' : String(s.respuesta);
        if (!s.respuesta) textarea.placeholder = 'Escribe la respuesta para ' + String(nombre) + '...';

        form.appendChild(crearRespuestasRapidas(sugerenciaId, textarea));
        form.appendChild(textarea);
        form.appendChild(crearAccionSugerencia(
            s.respuesta ? 'Guardar respuesta' : 'Enviar respuesta',
            'btn btn-primary',
            () => enviarRespuestaSugerencia(sugerenciaId)
        ));

        if (s.respuesta) {
            const response = document.createElement('div');
            response.className = 'sugerencia-respuesta';
            response.appendChild(crearElementoSugerencia('strong', '', 'Tu respuesta:'));
            response.appendChild(crearElementoSugerencia('p', '', s.respuesta));
            response.appendChild(crearAccionSugerencia('Editar respuesta', 'btn', () => {
                form.classList.toggle('hidden');
            }));
            card.appendChild(response);
        } else {
            card.appendChild(crearAccionSugerencia('Responder', 'btn', () => {
                form.classList.toggle('hidden');
            }));
        }

        card.appendChild(form);
        lista.appendChild(card);
    });
}

/**
 * API histórica conservada para compatibilidad: ahora devuelve un nodo DOM,
 * no una cadena HTML. El contenido de respuesta rápida nunca se interpreta como markup.
 */
export function respuestasRapidasHtml(sugerenciaId) {
    const textarea = document.createElement('textarea');
    textarea.id = 'respuesta-texto-' + String(sugerenciaId);
    return crearRespuestasRapidas(sugerenciaId, textarea);
}

export function mostrarFormRespuestaSugerencia(sugerenciaId) {
    const form = document.getElementById('form-respuesta-' + String(sugerenciaId));
    if (form) form.classList.toggle('hidden');
}

export function aplicarRespuestaRapida(sugerenciaId, boton) {
    const textarea = document.getElementById('respuesta-texto-' + String(sugerenciaId));
    if (textarea) textarea.value = String(boton?.dataset?.texto || '');
}

export async function enviarRespuestaSugerencia(sugerenciaId) {
    if (!window.requiereConexionParaOperar()) return;
    const textarea = document.getElementById('respuesta-texto-' + String(sugerenciaId));
    if (!textarea) return;
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
    const { error } = await window.supabaseClient.from('sugerencias')
        .update({ leida: true }).eq('id', sugerenciaId);
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
