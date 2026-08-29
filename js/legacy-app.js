/**
 * CuevaCoin — js/legacy-app.js
 * Cargador secuencial de partes (a/b/c) por límite de tamaño en deploy.
 * Ejecuta las partes en orden, mismo scope global que el monolito original.
 */
(function loadLegacyParts() {
  var parts = [
    'js/legacy-app-a.js',
    'js/legacy-app-b.js',
    'js/legacy-app-c.js'
  ];
  var i = 0;
  function next() {
    if (i >= parts.length) return;
    var s = document.createElement('script');
    s.src = parts[i] + '?v=restore-retiro-1';
    i += 1;
    s.onload = next;
    s.onerror = function () {
      console.error('[CuevaCoin] No se pudo cargar', s.src);
    };
    (document.body || document.head || document.documentElement).appendChild(s);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', next);
  } else {
    next();
  }
})();
