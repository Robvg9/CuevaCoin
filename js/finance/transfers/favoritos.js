/** Fase 3 / Oleada 4 — Favoritos de transferencia */

function crearTextoFavorito(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value == null ? '' : String(value);
    return element;
}

export async function refrescarFavoritosIdsCache() {
    const { data, error } = await window.supabaseClient.from('favoritos').select('favorito_id');
    if (error) {
        console.error('Error refrescando cache de favoritos:', error);
        return;
    }
    window.favoritosIdsCache = new Set((data || []).map(f => f.favorito_id));
}

export async function cargarChipsFavoritos() {
    const contenedor = document.getElementById('transferir-favoritos-chips');
    if (!contenedor) return;
    contenedor.replaceChildren();
    contenedor.appendChild(crearTextoFavorito('p', 'favoritos-vacio', 'Cargando favoritos...'));

    const { data, error } = await window.supabaseClient
        .from('favoritos')
        .select('favorito_id, favorito:favorito_id(nombre, usuario, correo)')
        .order('creado_en', { ascending: false });

    if (error) {
        console.error('Error cargando favoritos:', error);
        contenedor.replaceChildren();
        return;
    }

    window.favoritosIdsCache = new Set((data || []).map(f => f.favorito_id));
    const favoritos = (data || []).filter(f => f.favorito?.correo);

    if (favoritos.length === 0) {
        contenedor.replaceChildren(
            crearTextoFavorito('p', 'favoritos-vacio', 'Aún no tienes favoritos. Márcalos con ⭐ desde tu historial.')
        );
        return;
    }

    const fragment = document.createDocumentFragment();
    favoritos.forEach(f => {
        const nombre = f.favorito.nombre || f.favorito.usuario || 'Favorito';
        const correo = String(f.favorito.correo);
        const button = crearTextoFavorito('button', 'favorito-chip', '⭐ ' + nombre);
        button.type = 'button';
        button.addEventListener('click', () => usarFavoritoParaTransferir(correo));
        fragment.appendChild(button);
    });
    contenedor.replaceChildren(fragment);
}

export function usarFavoritoParaTransferir(correo) {
    const input = document.getElementById('transferir-destinatario-correo');
    if (input) input.value = String(correo || '');
}

export async function toggleFavorito(contraparteId, nombre, botonEl) {
    if (!window.requiereConexionParaOperar()) return;
    const usuario = JSON.parse(sessionStorage.getItem('cuevacoin_usuario_actual'));
    const esFavoritoActual = window.favoritosIdsCache.has(contraparteId);

    if (esFavoritoActual) {
        const { error } = await window.supabaseClient
            .from('favoritos')
            .delete()
            .eq('usuario_id', usuario.id)
            .eq('favorito_id', contraparteId);
        if (error) {
            console.error(error);
            window.showToast('No se pudo quitar de favoritos', 3000);
            return;
        }
        window.favoritosIdsCache.delete(contraparteId);
        window.showToast(String(nombre || '') + ' ya no es favorito', 2500);
    } else {
        const { error } = await window.supabaseClient
            .from('favoritos')
            .insert({ usuario_id: usuario.id, favorito_id: contraparteId });
        if (error) {
            console.error(error);
            window.showToast('No se pudo agregar a favoritos', 3000);
            return;
        }
        window.favoritosIdsCache.add(contraparteId);
        window.showToast(String(nombre || '') + ' agregado a favoritos ⭐', 2500);
    }

    if (botonEl) {
        const esFavoritoAhora = window.favoritosIdsCache.has(contraparteId);
        botonEl.textContent = esFavoritoAhora ? '⭐' : '☆';
        botonEl.title = esFavoritoAhora ? 'Quitar de favoritos' : 'Agregar a favoritos';
    }
}

if (typeof window !== 'undefined') {
    window.refrescarFavoritosIdsCache = refrescarFavoritosIdsCache;
    window.cargarChipsFavoritos = cargarChipsFavoritos;
    window.usarFavoritoParaTransferir = usarFavoritoParaTransferir;
    window.toggleFavorito = toggleFavorito;
}
