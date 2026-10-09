/** Fase 3 / Oleada 6 — loadUserHistorial */

export async function loadUserHistorial(usuarioId) {
    const tipoFiltro = document.getElementById('user-filter-tipo').value;
    const fechaDesde = document.getElementById('user-filter-fecha-desde').value; // 'YYYY-MM-DD' o ''
    const fechaHasta = document.getElementById('user-filter-fecha-hasta').value;
    const textoFiltro = document.getElementById('user-filter-texto').value.trim().toLowerCase();
    const cardsContainer = document.getElementById('user-transacciones-cards');
    const vacioMsg = document.getElementById('user-historial-vacio');
    cardsContainer.innerHTML = '';

    // RLS ya limita esto a las propias transacciones del usuario
    // F1 (v63): se agrega el join a "contraparte" (nombre/usuario) para
    // poder ofrecer el botón de favorito en transferencias enviadas/recibidas.
    const { data: transacciones, error } = await window.supabaseClient
        .from('transacciones')
        .select('*, admin:admin_id(nombre, usuario), contraparte:contraparte_id(nombre, usuario)')
        .eq('usuario_id', usuarioId)
        .order('creado_en', { ascending: false });

    // F1 (v63): refrescar qué contrapartes ya son favoritas, para
    // pintar la estrella llena/vacía de entrada en cada tarjeta.
    window.refrescarFavoritosIdsCache();

    if (error) {
        console.error(error);
        window.showToast('No se pudo cargar el historial', 3000);
        return;
    }

    // Categoría real de cada transacción según su "tipo" en la BD (no solo el
    // signo de "cantidad"), para que cada opción del filtro muestre EXACTAMENTE
    // lo que promete y nunca se mezclen (ej. un retiro no debe salir como "Enviado").
    //   - 'transferencia' con cantidad > 0  -> recibido (verde)
    //   - 'transferencia' con cantidad < 0  -> enviado  (rojo)
    //   - 'retiro' o 'retiro_admin'          -> retiro   (rojo)
    //   - 'deposito_admin'                   -> salario  (amarillo, solo lo paga el admin)
    function categoriaTransaccion(t) {
        const cantidad = Number(t.cantidad);
        if (t.tipo === 'retiro_admin') return cantidad < 0 ? 'descuento' : 'ajuste';
        if (t.tipo === 'retiro') return 'retiro';
        if (t.tipo === 'deposito_admin') return 'salario';
        if (t.tipo === 'transferencia') return cantidad > 0 ? 'recibido' : 'enviado';
        // Respaldo por si aparece un tipo no contemplado: se clasifica por el signo.
        return cantidad > 0 ? 'recibido' : 'enviado';
    }

    // F4 (v67): los 4 filtros se combinan con AND - una transacción
    // solo se muestra si pasa TODOS los que estén activos (los vacíos
    // se ignoran, mismo criterio combinable que E13 en Auditoría).
    const transaccionesFiltradas = transacciones.filter(t => {
        if (tipoFiltro !== '' && categoriaTransaccion(t) !== tipoFiltro) return false;

        if (fechaDesde || fechaHasta) {
            const fechaTx = t.creado_en.slice(0, 10); // 'YYYY-MM-DD'
            if (fechaDesde && fechaTx < fechaDesde) return false;
            if (fechaHasta && fechaTx > fechaHasta) return false;
        }

        if (textoFiltro !== '') {
            const nombreContraparteTexto = t.contraparte ? (t.contraparte.nombre || t.contraparte.usuario || '') : '';
            const bolsaTexto = `${t.motivo || ''} ${nombreContraparteTexto}`.toLowerCase();
            if (!bolsaTexto.includes(textoFiltro)) return false;
        }

        return true;
    });

    ultimoHistorialFiltrado = transaccionesFiltradas;

    if (transaccionesFiltradas.length === 0) {
        cardsContainer.classList.add('hidden');
        vacioMsg.classList.remove('hidden');
        return;
    }
    cardsContainer.classList.remove('hidden');
    vacioMsg.classList.add('hidden');

    const etiquetas = {
        recibido: 'Recibido',
        enviado: 'Enviado',
        retiro: 'Retiro',
        descuento: 'Descuento admin',
        salario: 'Pago del admin',
        deposito: 'Depósito',
        ajuste: 'Ajuste',
    };

    // FIX (v74): pedido del usuario - el historial "no se entiende nada,
    // parece de imprenta". Se agrega un ícono grande por tipo (para
    // reconocer de un vistazo qué es cada movimiento sin leer el
    // texto) y una explicación corta de qué significa, que se ve
    // tocando/pasando el mouse por el ícono (title=).
    const iconosTipo = {
        recibido: '💰',
        enviado: '📤',
        retiro: '🏧',
        descuento: '➖',
        salario: '💵',
        deposito: '➕',
        ajuste: '⚖️',
    };
    const explicacionTipo = {
        recibido: 'Dinero que otra persona te transfirió',
        enviado: 'Dinero que tú le transferiste a otra persona',
        retiro: 'Dinero que retiraste de tu cuenta',
        descuento: 'Dinero que el administrador descontó de tu saldo. Revisa el motivo para identificar si fue un cobro en efectivo u otro ajuste.',
        salario: 'Dinero que el administrador agregó a tu saldo (salario, bono o depósito)',
        deposito: 'Dinero que el admin agregó a tu cuenta',
        ajuste: 'Corrección de saldo hecha por el admin',
    };

    transaccionesFiltradas.forEach(t => {
        const categoria = categoriaTransaccion(t);
        const cantidad = Number(t.cantidad);
        const tipo = etiquetas[categoria] || (cantidad > 0 ? 'Recibido' : 'Enviado');
        const cantidadAbs = Math.abs(cantidad);
        const fecha = new Date(t.creado_en).toLocaleDateString('es-ES', { 
            day: '2-digit', 
            month: 'short', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        const adminNombre = t.admin ? (t.admin.nombre || t.admin.usuario) : 'N/A';
        const saldoAntes = t.saldo_antes != null ? `$${Number(t.saldo_antes).toFixed(2)}` : '-';
        const saldoDespues = t.saldo_despues != null ? `$${Number(t.saldo_despues).toFixed(2)}` : '-';

        // F2 (v63): guardamos la etiqueta legible en la propia transacción
        // para que window.generarTextoComprobante() no tenga que recalcularla.
        t.tipoEtiqueta = tipo;

        // F1 (v63): el botón de favorito solo tiene sentido en transferencias
        // (enviado/recibido) con una contraparte real - un retiro o un salario
        // no tienen "a quién agregar a favoritos".
        const esFavoritable = (categoria === 'enviado' || categoria === 'recibido') && t.contraparte_id;
        const nombreContraparte = t.contraparte ? (t.contraparte.nombre || t.contraparte.usuario) : '';
        const esFavoritoActual = esFavoritable && window.favoritosIdsCache.has(t.contraparte_id);
        const botonFavorito = esFavoritable
            ? `<button type="button" class="tx-card-favorito-btn" title="${esFavoritoActual ? 'Quitar de favoritos' : 'Agregar a favoritos'}" onclick="toggleFavorito('${t.contraparte_id}', '${nombreContraparte.replace(/'/g, "\\'")}', this)">${esFavoritoActual ? '⭐' : '☆'}</button>`
            : '';

        const card = document.createElement('div');
        card.className = 'tx-card';
        card.innerHTML = `
            <div class="tx-card-header">
                <span class="tx-card-icono tx-card-icono-${categoria}" title="${explicacionTipo[categoria] || ''}">${iconosTipo[categoria] || '🔹'}</span>
                <div class="tx-card-titulo">
                    <span class="tx-card-tipo ${categoria}">${tipo}</span>
                    <span class="tx-card-fecha">${fecha}</span>
                </div>
                <div class="tx-card-monto ${cantidad >= 0 ? 'positivo' : 'negativo'}">
                    ${cantidad >= 0 ? '+' : ''}$${cantidadAbs.toFixed(2)}
                </div>
            </div>
            <p class="tx-card-explicacion">${explicacionTipo[categoria] || ''}</p>
            <div class="tx-card-detalles">
                <span class="tx-card-motivo">📝 ${t.motivo || 'Sin motivo'}</span>
                <span title="Quién aprobó/procesó este movimiento">👤 ${adminNombre}</span>
            </div>
            <div class="tx-card-saldos" title="Cómo cambió tu saldo con este movimiento">
                Saldo: ${saldoAntes} → <strong>${saldoDespues}</strong>
            </div>
            <div class="tx-card-acciones">
                ${botonFavorito}
                <button type="button" class="btn tx-card-comprobante-btn" onclick='window.compartirComprobante(${JSON.stringify(t).replace(/'/g, "&apos;")})'>📄 Comprobante</button>
            </div>
        `;
        cardsContainer.appendChild(card);
    });
}

if (typeof window !== 'undefined') {
    window.loadUserHistorial = loadUserHistorial;
}
