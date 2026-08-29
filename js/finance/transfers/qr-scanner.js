/** Fase 3 / Oleada 4 — Scanner QR financiero */

export async function iniciarCamaraScanner() {
    const video = document.getElementById('escaner-qr-video');
    const estado = document.getElementById('escaner-qr-estado');
    estado.textContent = 'Apunta la cámara al código QR del perfil de la persona.';
    escanerQRProcesando = false;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        estado.textContent = 'Este dispositivo/navegador no permite usar la cámara acá. Escribe el correo a mano.';
        return;
    }

    try {
        escanerQRStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }
        });
        video.srcObject = escanerQRStream;
        await video.play();
        escanerQRAnimId = requestAnimationFrame(loopEscanerQR);
    } catch (err) {
        console.error('Error abriendo cámara para escanear QR:', err);
        estado.textContent = 'No se pudo acceder a la cámara (¿diste permiso?). Escribe el correo a mano.';
    }
}

export function detenerCamaraScanner() {
    if (escanerQRAnimId) {
        cancelAnimationFrame(escanerQRAnimId);
        escanerQRAnimId = null;
    }
    if (escanerQRStream) {
        escanerQRStream.getTracks().forEach((t) => t.stop());
        escanerQRStream = null;
    }
}

export function abrirScannerQR(tabInicial) {
    window.openModal('scanner-qr-modal');
    cambiarTabScanner(tabInicial || 'escanear');
}

export function cambiarTabScanner(tab) {
    const panelEscanear = document.getElementById('scanner-tab-escanear');
    const panelMiQR = document.getElementById('scanner-tab-mi-qr');
    const btnEscanear = document.getElementById('scanner-tab-btn-escanear');
    const btnMiQR = document.getElementById('scanner-tab-btn-mi-qr');

    if (tab === 'mi-qr') {
        detenerCamaraScanner();
        panelEscanear.style.display = 'none';
        panelMiQR.style.display = 'block';
        btnEscanear.classList.remove('btn-primary');
        btnEscanear.classList.add('btn-secondary');
        btnMiQR.classList.remove('btn-secondary');
        btnMiQR.classList.add('btn-primary');
        renderizarMiCodigoQR();
    } else {
        panelMiQR.style.display = 'none';
        panelEscanear.style.display = 'block';
        btnMiQR.classList.remove('btn-primary');
        btnMiQR.classList.add('btn-secondary');
        btnEscanear.classList.remove('btn-secondary');
        btnEscanear.classList.add('btn-primary');
        iniciarCamaraScanner();
    }
}

export function cerrarScannerQR() {
    detenerCamaraScanner();
    window.closeModal('scanner-qr-modal');
}

export function loopEscanerQR() {
    const video = document.getElementById('escaner-qr-video');
    const canvas = document.getElementById('escaner-qr-canvas');
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA || escanerQRProcesando) {
        escanerQRAnimId = requestAnimationFrame(loopEscanerQR);
        return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imagen = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const codigo = typeof jsQR === 'function' ? jsQR(imagen.data, imagen.width, imagen.height) : null;

    if (codigo && codigo.data) {
        escanerQRProcesando = true;
        procesarQREscaneado(codigo.data);
        return; // no seguimos pidiendo frames hasta que se resuelva
    }
    escanerQRAnimId = requestAnimationFrame(loopEscanerQR);
}

export async function procesarQREscaneado(texto) {
    const estado = document.getElementById('escaner-qr-estado');
    const prefijo = 'CUEVACOIN:';
    if (!texto.startsWith(prefijo)) {
        estado.textContent = 'Ese QR no es de CuevaCoin. Sigue apuntando o cancela.';
        escanerQRProcesando = false;
        escanerQRAnimId = requestAnimationFrame(loopEscanerQR);
        return;
    }
    const numeroCuenta = texto.slice(prefijo.length).trim();
    estado.textContent = 'Código leído, buscando la cuenta...';

    try {
        const { data, error } = await window.supabaseClient.functions.invoke('resolver-cuenta-qr', {
            body: { numeroCuenta }
        });
        if (error || !data || data.error) {
            estado.textContent = (data && data.error) ? data.error : 'No se pudo resolver ese código QR.';
            escanerQRProcesando = false;
            escanerQRAnimId = requestAnimationFrame(loopEscanerQR);
            return;
        }
        document.getElementById('transferir-destinatario-correo').value = data.correo;
        window.transferenciaViaQR = true;
        cerrarScannerQR();
        const nombreMostrado = [data.nombre, data.apellido].filter(Boolean).join(' ') || data.correo;
        window.showToast(`Destinatario cargado: ${nombreMostrado}`, 3000);
    } catch (err) {
        console.error('Error resolviendo QR escaneado:', err);
        estado.textContent = 'Error de conexión buscando esa cuenta. Sigue apuntando o cancela.';
        escanerQRProcesando = false;
        escanerQRAnimId = requestAnimationFrame(loopEscanerQR);
    }
}

if (typeof window !== 'undefined') {
    window.iniciarCamaraScanner = iniciarCamaraScanner;
    window.detenerCamaraScanner = detenerCamaraScanner;
    window.abrirScannerQR = abrirScannerQR;
    window.cambiarTabScanner = cambiarTabScanner;
    window.cerrarScannerQR = cerrarScannerQR;
    window.loopEscanerQR = loopEscanerQR;
    window.procesarQREscaneado = procesarQREscaneado;
}
