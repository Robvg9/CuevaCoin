/** CuevaCoin — js/admin/finance/charts.js
 * Fase 5 — Charts/estadísticas admin (lectura UI, sin mutar saldo).
 */

export async function loadEstadisticasAdmin(rangoParam) {
    const selectEl = document.getElementById('estadisticas-rango-select');
    const rango = rangoParam || selectEl.value || 'mes';
    if (selectEl.value !== rango) selectEl.value = rango;
    const { desde, buckets } = window.calcularRangoEstadisticas(rango);
    const etiquetaRango = window.etiquetaRangoEstadisticas(rango);
    document.getElementById('estadisticas-pagos-subtitulo').textContent = `Salarios y bonos pagados a las trabajadoras, ${etiquetaRango}.`;
    document.getElementById('estadisticas-retiros-subtitulo').textContent = `Solicitudes de retiro recibidas, ${etiquetaRango}.`;
    document.getElementById('estadisticas-activas-subtitulo').textContent = `Por cantidad de movimientos (transferencias, pagos, retiros), ${etiquetaRango}.`;
    document.getElementById('estadisticas-activas-vacio').textContent = `Sin movimientos ${etiquetaRango}.`;
    await Promise.all([
        cargarChartPagosPorMes(rango, desde, buckets),
        cargarChartRetirosPorEstado(desde),
        cargarChartTrabajadorasActivas(desde),
    ]);
}

export async function cargarChartPagosPorMes(rango, desde, buckets) {
    const { data, error } = await window.supabaseClient
        .from('transacciones')
        .select('cantidad, motivo, creado_en')
        .eq('tipo', 'deposito_admin')
        .gte('creado_en', desde.toISOString());
    if (error) {
        console.error('Error cargando pagos por mes:', error);
        return;
    }

    (data || []).forEach(t => {
        const clave = window.claveBucketDeFecha(t.creado_en, rango);
        const bucket = buckets.find(b => b.clave === clave);
        if (!bucket) return;
        // admin_pagar_saldo() antepone "Bono: " al motivo cuando
        // p_tipo='bono' (ver función en Supabase) - es la única
        // forma de distinguirlo desde el cliente, porque ambos
        // quedan como tipo='deposito_admin' en la tabla.
        if ((t.motivo || '').startsWith('Bono: ')) {
            bucket.bono += Number(t.cantidad) || 0;
        } else {
            bucket.salario += Number(t.cantidad) || 0;
        }
    });

    if (chartPagosMes) chartPagosMes.destroy();
    chartPagosMes = new Chart(document.getElementById('chart-pagos-mes'), {
        type: 'bar',
        data: {
            labels: buckets.map(b => b.etiqueta),
            datasets: [
                { label: 'Salarios', data: buckets.map(b => b.salario), backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim() || '#FFB6C1' },
                { label: 'Bonos', data: buckets.map(b => b.bono), backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--accent-secondary').trim() || '#E6E6FA' },
            ],
        },
        options: {
            responsive: true,
            scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => '$' + v } } },
            plugins: { legend: { position: 'bottom' } },
        },
    });
}

export async function cargarChartRetirosPorEstado(desde) {
    const { data, error } = await window.supabaseClient
        .from('solicitudes_retiro')
        .select('estado')
        .gte('creado_en', desde.toISOString());
    if (error) {
        console.error('Error cargando retiros por estado:', error);
        return;
    }
    const conteo = { pendiente: 0, aprobado: 0, rechazado: 0 };
    (data || []).forEach(s => {
        if (conteo[s.estado] === undefined) conteo[s.estado] = 0;
        conteo[s.estado]++;
    });
    const etiquetas = { pendiente: 'Pendientes', aprobado: 'Aprobados', rechazado: 'Rechazados' };

    if (chartRetirosEstado) chartRetirosEstado.destroy();
    chartRetirosEstado = new Chart(document.getElementById('chart-retiros-estado'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(conteo).map(k => etiquetas[k] || k),
            datasets: [{
                data: Object.values(conteo),
                backgroundColor: ['#FBBF24', '#4ADE80', '#F87171', '#A78BFA'],
            }],
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } },
    });
}

export async function cargarChartTrabajadorasActivas(desde) {
    const { data, error } = await window.supabaseClient
        .from('transacciones')
        .select('usuario_id')
        .gte('creado_en', desde.toISOString());
    if (error) {
        console.error('Error cargando trabajadoras activas:', error);
        return;
    }

    const conteoPorUsuario = {};
    (data || []).forEach(t => {
        conteoPorUsuario[t.usuario_id] = (conteoPorUsuario[t.usuario_id] || 0) + 1;
    });
    const idsOrdenados = Object.keys(conteoPorUsuario).sort((a, b) => conteoPorUsuario[b] - conteoPorUsuario[a]).slice(0, 5);

    const vacioEl = document.getElementById('estadisticas-activas-vacio');
    const canvasEl = document.getElementById('chart-trabajadoras-activas');
    if (idsOrdenados.length === 0) {
        if (chartTrabajadorasActivas) chartTrabajadorasActivas.destroy();
        canvasEl.classList.add('hidden');
        vacioEl.classList.remove('hidden');
        return;
    }
    canvasEl.classList.remove('hidden');
    vacioEl.classList.add('hidden');

    const { data: perfilesData, error: errorPerfiles } = await window.supabaseClient
        .from('perfiles')
        .select('id, nombre, usuario')
        .in('id', idsOrdenados);
    if (errorPerfiles) console.error('Error cargando nombres de trabajadoras activas:', errorPerfiles);
    const nombrePorId = {};
    (perfilesData || []).forEach(p => { nombrePorId[p.id] = p.nombre || p.usuario; });

    if (chartTrabajadorasActivas) chartTrabajadorasActivas.destroy();
    chartTrabajadorasActivas = new Chart(canvasEl, {
        type: 'bar',
        data: {
            labels: idsOrdenados.map(id => nombrePorId[id] || 'Desconocida'),
            datasets: [{
                label: 'Movimientos',
                data: idsOrdenados.map(id => conteoPorUsuario[id]),
                backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim() || '#FFB6C1',
            }],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } },
            plugins: { legend: { display: false } },
        },
    });
}

if (typeof window !== 'undefined') {
    window.loadEstadisticasAdmin = loadEstadisticasAdmin;
    window.cargarChartPagosPorMes = cargarChartPagosPorMes;
    window.cargarChartRetirosPorEstado = cargarChartRetirosPorEstado;
    window.cargarChartTrabajadorasActivas = cargarChartTrabajadorasActivas;
}
