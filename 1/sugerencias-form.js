/**
 * CuevaCoin — js/ui/sugerencias-form.js
 * Envío de sugerencia desde Bonos (trabajadora) — Oleada 5.
 * No incluye respuestas admin ni lógica financiera.
 */

export async function enviarSugerenciaUsuario() {
    const requiere = (typeof window !== 'undefined' && window.requiereConexionParaOperar)
        ? window.requiereConexionParaOperar : () => true;
    const toast = (typeof window !== 'undefined' && window.showToast) ? window.showToast : () => {};
    const client = (typeof window !== 'undefined') ? window.supabaseClient : null;
    const loadLista = (typeof window !== 'undefined' && window.loadUserSugerencias)
        ? window.loadUserSugerencias : async () => {};

    if (!requiere()) return;
    const input = document.getElementById('sugerencia-mensaje');
    if (!input) return;
    const mensaje = input.value.trim();
    if (!mensaje) {
        toast('Escribe tu sugerencia antes de enviar', 3000);
        return;
    }
    const usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual') || 'null');
    if (!usuario || !client) {
        toast('No se pudo enviar la sugerencia', 3000);
        return;
    }

    const { error } = await client.from('sugerencias').insert({
        usuario_id: usuario.id,
        mensaje: mensaje
    });
    if (error) {
        console.error(error);
        toast('No se pudo enviar la sugerencia', 3000);
        return;
    }

    const { data: adminSugerencia, error: errorAdminSugerencia } = await client
        .from('perfiles')
        .select('id')
        .eq('es_admin', true)
        .limit(1)
        .single();
    if (!errorAdminSugerencia && adminSugerencia) {
        const nombreRemitente = usuario.nombre || usuario.usuario;
        const mensajeNotifSugerencia = `${nombreRemitente} mandó una sugerencia en Bonos`;
        const { error: errorNotifSugerencia } = await client.from('notificaciones').insert({
            usuario_id: adminSugerencia.id,
            mensaje: mensajeNotifSugerencia,
            leida: false,
            tipo_evento: 'sugerencia'
        });
        if (errorNotifSugerencia) console.error(errorNotifSugerencia);
        client.functions.invoke('enviar-push', {
            body: { usuario_id: adminSugerencia.id, mensaje: mensajeNotifSugerencia, tipo_evento: 'sugerencia' }
        }).catch((err) => console.error('Error mandando push de sugerencia:', err));
    }

    input.value = '';
    toast('Sugerencia enviada, ¡gracias!', 2500);
    await loadLista(usuario.id);
}

export function setupSugerenciaForm() {
    const form = document.getElementById('sugerencia-form');
    if (!form || form.dataset.cuevacoinBound) return;
    form.dataset.cuevacoinBound = '1';
    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        await enviarSugerenciaUsuario();
    });
}

if (typeof window !== 'undefined') {
    window.enviarSugerenciaUsuario = enviarSugerenciaUsuario;
    window.setupSugerenciaForm = setupSugerenciaForm;
}
