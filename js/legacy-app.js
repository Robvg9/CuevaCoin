/**
 * CuevaCoin — js/legacy-app.js
 * RESTORE loader: fetches ordered chunks and runs as one classic script.
 */
(function () {
  var chunks = ['js/legacy-chunks/a0.js', 'js/legacy-chunks/a1.js', 'js/legacy-chunks/a2.js', 'js/legacy-chunks/a3.js', 'js/legacy-chunks/a4.js', 'js/legacy-chunks/a5.js', 'js/legacy-chunks/b0.js', 'js/legacy-chunks/b1.js', 'js/legacy-chunks/b2.js', 'js/legacy-chunks/b3.js', 'js/legacy-chunks/b4.js', 'js/legacy-chunks/b5.js', 'js/legacy-chunks/c0.js', 'js/legacy-chunks/c1.js', 'js/legacy-chunks/c2.js', 'js/legacy-chunks/c3.js', 'js/legacy-chunks/c4.js', 'js/legacy-chunks/c5.js'];
  var i = 0;
  var code = '';
  function next() {
    if (i >= chunks.length) {
      var s = document.createElement('script');
      s.text = code;
      (document.body || document.documentElement).appendChild(s);
      return;
    }
    var url = chunks[i++] + '?v=restore2';
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.text();
    }).then(function (t) {
      code += t;
      next();
    }).catch(function (e) {
      console.error('[CuevaCoin] legacy chunk load failed', e);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', next);
  } else {
    next();
  }
})();
