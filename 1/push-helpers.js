/**
 * CuevaCoin — js/ui/push-helpers.js
 * Helpers puros de Web Push (Fase 3 / Oleada 2).
 * NO incluye activarNotificacionesPush ni sincronizarSuscripcionPush (legacy).
 */

export function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

if (typeof window !== 'undefined') {
    window.urlBase64ToUint8Array = urlBase64ToUint8Array;
}
