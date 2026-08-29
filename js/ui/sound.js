/**
 * CuevaCoin — js/ui/sound.js
 * Aviso sonoro/vibración al recibir notificación en primer plano (Fase 3 / Oleada 2).
 */

export function reproducirAvisoNotificacion() {
    if (localStorage.getItem('cuevacoin_sonido_vibracion') !== 'true') return;

    if (navigator.vibrate) {
        try { navigator.vibrate(200); } catch (err) { /* algunos navegadores lo bloquean */ }
    }

    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
        osc.onended = () => ctx.close();
    } catch (err) {
        console.error('No se pudo reproducir el sonido de notificación:', err);
    }
}

if (typeof window !== 'undefined') {
    window.reproducirAvisoNotificacion = reproducirAvisoNotificacion;
}
