/**
 * CuevaCoin — js/core/state.js
 * Estado global mutable de la app (Fase 2 / Oleada 1).
 * Solo declaraciones; sin lógica de negocio, sin funciones de cola/retiro/transferencia.
 * Comportamiento 1:1 con el monolito original (v125).
 *
 * Nota: mientras index.html siga teniendo las mismas declaraciones,
 * este módulo es la fuente canónica prevista. Al cablear, se usarán
 * estas exportaciones (y el bridge window) en lugar de los let locales.
 */

// ============================================
// PWA / Service Worker (flags de UI)
// ============================================
/** true si ya se programó un reload por controllerchange (evitar doble reload) */
export let recargoPorSwNuevo = false;

/** Evento beforeinstallprompt capturado para el botón "Instalar" */
export let deferredPrompt = null;

// ============================================
// REALTIME CHANNELS (uno por tipo; se limpian al logout)
// ============================================
export let chatRealtimeChannel = null;
export let chatGrupalRealtimeChannel = null;
export let notifRealtimeChannel = null;
export let saldoRealtimeChannel = null;
export let solicitudesRetiroRealtimeChannel = null;
export let sugerenciasRealtimeChannel = null;

// Poll de seguridad para notificaciones cuando Realtime queda colgado
export let notifPollInterval = null;
export let notifPollUsuarioId = null;

// ============================================
// CUENTA / SESIÓN UI
// ============================================
/** true mientras la cuenta del trabajador logueado está desactivada */
export let cuentaDesactivadaGlobal = false;

// ============================================
// NOTIFICACIONES / NOVEDADES (puntos rojos del menú)
// ============================================
export let hayNovedadMenuGlobal = false;
export let hayNotifSinLeerGlobal = false;

// ============================================
// FRANJA DE CONEXIÓN
// ============================================
export let conexionStripOcultarTimeout = null;

// ============================================
// FAVORITOS (caché en memoria)
// ============================================
export let favoritosIdsCache = new Set();

// ============================================
// QR (código propio + escáner)
// ============================================
export let miQRInstancia = null;
export let escanerQRStream = null;
export let escanerQRAnimId = null;
export let escanerQRProcesando = false;
export let transferenciaViaQR = false;
export let transferenciaPendienteQR = null;

// ============================================
// COLA OFFLINE / IDEMPOTENCY (solo flags y claves; sin funciones)
// ============================================
export const CLAVE_COLA_PENDIENTE = 'cuevacoin_cola_pendiente';
export let sincronizandoColaEnCurso = false;

export let retiroIdempotencyKeyEnVuelo = null;
export const RETIRO_IDEMPOTENCY_STORAGE_KEY = 'cuevacoin_retiro_idempotency_key';

// ============================================
// ADMIN: filtros, selección destinatarios, charts
// ============================================
export let debounceFiltroUsuariosAdminId = null;
export let debounceFiltroAuditoriaId = null;
export let datalistUsuariosAuditoriaCargado = false;

export let seleccionDestinatariosSalario = [];
export let seleccionDestinatariosBono = [];
export let contextoSeleccionDestinatarios = null;

export let chartPagosMes = null;
export let chartRetirosEstado = null;
export let chartTrabajadorasActivas = null;

// ============================================
// CHAT / FELICITACIÓN
// ============================================
export let felicitacionPrivadoContraparteId = null;

// ============================================
// HISTORIAL USUARIO
// ============================================
export let debounceFiltroHistorialTextoId = null;
export let ultimoHistorialFiltrado = [];

// ============================================
// FOTO DE PERFIL (cropper)
// ============================================
export let cropperFotoPerfil = null;
export let urlObjetoFotoPerfilTemp = null;

// ============================================
// PUSH (llave pública VAPID — segura de exponer)
// ============================================
export const VAPID_PUBLIC_KEY =
    "BLc7-wVfO7eSUt_BzhUtL-mno7iKOCQqFLVqJryOZu2N0kJ1XvoGzafQC2y3YLGBR5fIkbrZiekb1yhHl-AoHuo";

// ============================================
// Compatibilidad con el monolito (scripts clásicos)
// ============================================
// Se asignan a window para que el código existente que lee/escribe estas
// variables globales siga funcionando cuando se cablee el módulo.
// Las que son `let` se exponen como propiedades de un objeto vivo para
// que las mutaciones se vean en ambos lados cuando se unifique.
if (typeof window !== 'undefined') {
    const g = window;

    g.recargoPorSwNuevo = recargoPorSwNuevo;
    g.deferredPrompt = deferredPrompt;

    g.chatRealtimeChannel = chatRealtimeChannel;
    g.chatGrupalRealtimeChannel = chatGrupalRealtimeChannel;
    g.notifRealtimeChannel = notifRealtimeChannel;
    g.saldoRealtimeChannel = saldoRealtimeChannel;
    g.solicitudesRetiroRealtimeChannel = solicitudesRetiroRealtimeChannel;
    g.sugerenciasRealtimeChannel = sugerenciasRealtimeChannel;
    g.notifPollInterval = notifPollInterval;
    g.notifPollUsuarioId = notifPollUsuarioId;

    g.cuentaDesactivadaGlobal = cuentaDesactivadaGlobal;
    g.hayNovedadMenuGlobal = hayNovedadMenuGlobal;
    g.hayNotifSinLeerGlobal = hayNotifSinLeerGlobal;
    g.conexionStripOcultarTimeout = conexionStripOcultarTimeout;

    g.favoritosIdsCache = favoritosIdsCache;

    g.miQRInstancia = miQRInstancia;
    g.escanerQRStream = escanerQRStream;
    g.escanerQRAnimId = escanerQRAnimId;
    g.escanerQRProcesando = escanerQRProcesando;
    g.transferenciaViaQR = transferenciaViaQR;
    g.transferenciaPendienteQR = transferenciaPendienteQR;

    g.CLAVE_COLA_PENDIENTE = CLAVE_COLA_PENDIENTE;
    g.sincronizandoColaEnCurso = sincronizandoColaEnCurso;
    g.retiroIdempotencyKeyEnVuelo = retiroIdempotencyKeyEnVuelo;
    g.RETIRO_IDEMPOTENCY_STORAGE_KEY = RETIRO_IDEMPOTENCY_STORAGE_KEY;

    g.debounceFiltroUsuariosAdminId = debounceFiltroUsuariosAdminId;
    g.debounceFiltroAuditoriaId = debounceFiltroAuditoriaId;
    g.datalistUsuariosAuditoriaCargado = datalistUsuariosAuditoriaCargado;
    g.seleccionDestinatariosSalario = seleccionDestinatariosSalario;
    g.seleccionDestinatariosBono = seleccionDestinatariosBono;
    g.contextoSeleccionDestinatarios = contextoSeleccionDestinatarios;
    g.chartPagosMes = chartPagosMes;
    g.chartRetirosEstado = chartRetirosEstado;
    g.chartTrabajadorasActivas = chartTrabajadorasActivas;

    g.felicitacionPrivadoContraparteId = felicitacionPrivadoContraparteId;
    g.debounceFiltroHistorialTextoId = debounceFiltroHistorialTextoId;
    g.ultimoHistorialFiltrado = ultimoHistorialFiltrado;

    g.cropperFotoPerfil = cropperFotoPerfil;
    g.urlObjetoFotoPerfilTemp = urlObjetoFotoPerfilTemp;

    g.VAPID_PUBLIC_KEY = VAPID_PUBLIC_KEY;
}
