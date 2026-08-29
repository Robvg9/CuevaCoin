/** Fase 3 / Oleada 6 — debounce filtro historial */

export function debounceFiltroHistorialTexto() {
    clearTimeout(debounceFiltroHistorialTextoId);
    debounceFiltroHistorialTextoId = setTimeout(() => {
        window.loadUserHistorial(JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual')).id);
    }, 350);
}

if (typeof window !== 'undefined') {
    window.debounceFiltroHistorialTexto = debounceFiltroHistorialTexto;
}
