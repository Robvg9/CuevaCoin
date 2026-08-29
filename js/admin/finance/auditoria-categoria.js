/** CuevaCoin — js/admin/finance/auditoria-categoria.js
 * Fase 4 — Clasificador de texto de auditoría.
 */

export function categoriaAuditoria(accion) {
    const texto = (accion || '').toLowerCase();
    if (texto.includes('retiro')) return 'retiro';
    if (texto.includes('saldo')) return 'saldo';
    if (texto.includes('usuario')) return 'usuario';
    if (texto.includes('sesión') || texto.includes('sesion')) return 'login';
    return 'otro';
}

if (typeof window !== 'undefined') {
    window.categoriaAuditoria = categoriaAuditoria;
}
