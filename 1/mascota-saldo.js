/** Fase 3 / Oleada 3 — Mascota de saldo */

export async function actualizarMascotaSaldo(usuario) {
    const emojiEl = document.getElementById('mascota-saldo-emoji');
    const textoEl = document.getElementById('mascota-saldo-texto');
    try {
        const haceSieteDias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await window.supabaseClient
            .from('transacciones')
            .select('saldo_despues, creado_en')
            .eq('usuario_id', usuario.id)
            .lte('creado_en', haceSieteDias)
            .order('creado_en', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;

        if (!data) {
            emojiEl.textContent = '🐹';
            emojiEl.classList.remove('animando');
            textoEl.textContent = 'Todavía no tengo una semana de historial tuyo para comparar.';
            return;
        }

        const saldoActual = Number(usuario.saldo) || 0;
        const saldoHaceSieteDias = Number(data.saldo_despues) || 0;
        const cambio = saldoHaceSieteDias > 0
            ? ((saldoActual - saldoHaceSieteDias) / saldoHaceSieteDias) * 100
            : (saldoActual > 0 ? 100 : 0);

        let emoji, texto, animar;
        if (cambio >= 20) {
            emoji = '🤩'; texto = '¡Tu saldo voló esta semana!'; animar = true;
        } else if (cambio >= 1) {
            emoji = '😊'; texto = 'Tu saldo subió esta semana, ¡bien ahí!'; animar = true;
        } else if (cambio > -1) {
            emoji = '😌'; texto = 'Tu saldo se mantuvo estable esta semana.'; animar = false;
        } else if (cambio > -20) {
            emoji = '😟'; texto = 'Tu saldo bajó un poco esta semana.'; animar = false;
        } else {
            emoji = '😢'; texto = 'Tu saldo bajó bastante esta semana.'; animar = false;
        }

        emojiEl.textContent = emoji;
        emojiEl.classList.toggle('animando', animar);
        textoEl.textContent = texto;
    } catch (err) {
        console.error('No se pudo calcular la mascota de saldo semanal:', err);
        emojiEl.textContent = '🐹';
        emojiEl.classList.remove('animando');
        textoEl.textContent = '';
    }
}

if (typeof window !== 'undefined') {
    window.actualizarMascotaSaldo = actualizarMascotaSaldo;
}
