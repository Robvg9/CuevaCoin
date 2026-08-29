        // arreglado arriba), la promesa quedaba rechazada sin atrapar y la
        // app se quedaba pegada para siempre en el spinner de arranque
        // (#arranque-splash), exactamente el síntoma reportado ("2 pantallas
        // de carga que se quedan trabadas" al abrir sin internet). Ahora,
        // pase lo que pase (incluido que se cuelgue sin fallar), como último
        // recurso se entra con el perfil cacheado si hay uno (modo offline)
        // o se manda al login - nunca se deja el spinner girando sin salida.
        conTimeoutArranque(procesarSesionYMostrarPantalla(), 12000).catch((err) => {
            console.error('Error inesperado (o timeout) al iniciar la app:', err);
            if (!(esErrorDeConexion(err) && entrarModoOfflineConPerfilCacheado())) {
                showLoginScreen();
            }
        });
