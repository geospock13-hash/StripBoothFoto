/* =====================================================================
   StripBoothFoto · Adaptador Android (Capacitor)
   Reemplaza el servidor interno (Node) por almacenamiento del dispositivo.
   - Intercepta las llamadas a api/*  (config, info, fuentes, marcos, foto, galeria)
   - Define window.lic (sin impresión; la impresión se quita en Android)
   - Las fotos del evento se guardan en:  Documentos/StripBoothFoto/<evento>/
       · la tira final      -> <evento>/tira_*.jpg
       · las fotos sueltas  -> <evento>/originales/original_*.jpg
   - Los marcos que sube el usuario se guardan en almacenamiento interno (DATA/marcos).
   ===================================================================== */
(function () {
  'use strict';

  var APP_DIR = 'StripBoothFoto';      // carpeta base en Documentos
  var MARCOS_DIR = 'marcos';           // carpeta interna para marcos (DATA)
  var CFG_KEY = 'sbf_config';          // clave de configuración (Preferences)
  var DOCS = 'DOCUMENTS';
  var DATA = 'DATA';

  function plugins() { return (window.Capacitor && window.Capacitor.Plugins) || {}; }
  function FS() { return plugins().Filesystem; }
  function PREFS() { return plugins().Preferences; }

  // --- utilidades ---
  function limpiar(s) {
    return String(s || '').replace(/[^\w\-. áéíóúÁÉÍÓÚñÑ]/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'Evento';
  }
  function sello() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function rnd() { return Math.floor(Math.random() * 900 + 100); }
  function J(obj, status) {
    return new Response(JSON.stringify(obj == null ? null : obj),
      { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  }
  function blobToB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onloadend = function () { res(String(r.result).split(',')[1] || ''); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }
  function bodyToBlob(body) {
    if (body instanceof Blob) return Promise.resolve(body);
    if (body instanceof ArrayBuffer) return Promise.resolve(new Blob([body]));
    return Promise.resolve(new Blob([body || '']));
  }
  async function ensureDir(dir, directory) {
    try { await FS().mkdir({ path: dir, directory: directory, recursive: true }); } catch (e) { /* ya existe */ }
  }

  // --- marcos: devolver un data URL para usar como img.src en Android ---
  window.marcoUrl = async function (nombre) {
    try {
      var r = await FS().readFile({ path: MARCOS_DIR + '/' + nombre, directory: DATA });
      var ext = (nombre.split('.').pop() || 'png').toLowerCase();
      var mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
      return 'data:' + mime + ';base64,' + r.data;
    } catch (e) {
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    }
  };

  // --- manejadores de cada endpoint ---
  async function h_config(method, body) {
    if (method === 'GET') {
      try { var g = await PREFS().get({ key: CFG_KEY }); return J(g && g.value ? JSON.parse(g.value) : {}); }
      catch (e) { return J({}); }
    }
    if (method === 'POST') {
      var txt = typeof body === 'string' ? body : await (await bodyToBlob(body)).text();
      try { await PREFS().set({ key: CFG_KEY, value: txt }); } catch (e) {}
      return J({ ok: true });
    }
  }

  function h_info() {
    return J({ ips: [], puerto: 0, equipo: 'Android', carpeta: 'Documentos/' + APP_DIR, version: (window.SBF_VERSION || '1.0') });
  }

  function h_fuentes() { return J([]); } // en Android no se listan fuentes del sistema; el diseño usa sus fuentes incluidas

  async function h_marcos(method, params, body) {
    if (method === 'GET') {
      try {
        await ensureDir(MARCOS_DIR, DATA);
        var r = await FS().readdir({ path: MARCOS_DIR, directory: DATA });
        var files = (r.files || []).map(function (f) { return typeof f === 'string' ? { name: f } : f; });
        var lista = files
          .filter(function (f) { return /\.(png|jpe?g|webp)$/i.test(f.name); })
          .map(function (f) { return { nombre: f.name, tam: f.size || 0, fecha: f.mtime || Date.now() }; })
          .sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
        return J(lista);
      } catch (e) { return J([]); }
    }
    if (method === 'POST') {
      var original = params.get('nombre') || 'marco.png';
      var m = original.toLowerCase().match(/\.(png|jpe?g|webp)$/);
      var ext = m ? m[0] : '.png';
      var base = limpiar(original.replace(/\.(png|jpe?g|webp)$/i, '')) || 'marco';
      await ensureDir(MARCOS_DIR, DATA);
      var nombre = base + ext, i = 2;
      // evitar sobrescribir
      try {
        var ex = await FS().readdir({ path: MARCOS_DIR, directory: DATA });
        var names = (ex.files || []).map(function (f) { return typeof f === 'string' ? f : f.name; });
        while (names.indexOf(nombre) !== -1) { nombre = base + '_' + (i++) + ext; }
      } catch (e) {}
      var b64 = await blobToB64(await bodyToBlob(body));
      await FS().writeFile({ path: MARCOS_DIR + '/' + nombre, data: b64, directory: DATA, recursive: true });
      return J({ nombre: nombre });
    }
  }

  async function h_marcoDelete(nombre) {
    try { await FS().deleteFile({ path: MARCOS_DIR + '/' + nombre, directory: DATA }); } catch (e) {}
    return J({ ok: true });
  }

  async function h_foto(params, body) {
    var evento = limpiar(params.get('evento')) || 'Evento';
    var tipo = params.get('tipo') === 'original' ? 'original' : 'tira';
    var n = limpiar(params.get('n') || '');
    var baseDir = APP_DIR + '/' + evento;
    var dir = tipo === 'original' ? baseDir + '/originales' : baseDir;
    await ensureDir(dir, DOCS);
    var nombre = tipo + '_' + sello() + (n ? '_' + n : '') + '_' + rnd() + '.jpg';
    var b64 = await blobToB64(await bodyToBlob(body));
    await FS().writeFile({ path: dir + '/' + nombre, data: b64, directory: DOCS, recursive: true });
    return J({ evento: evento, archivo: nombre, pagina: '' });
  }

  async function h_galeria(method, params) {
    var evento = limpiar(params.get('evento'));
    var dir = APP_DIR + '/' + evento;
    if (method === 'GET') {
      try {
        var r = await FS().readdir({ path: dir, directory: DOCS });
        var files = (r.files || []).map(function (f) { return typeof f === 'string' ? f : f.name; });
        var lista = files.filter(function (f) { return /^tira_.*\.jpg$/i.test(f); }).sort().reverse();
        return J(lista);
      } catch (e) { return J([]); }
    }
    if (method === 'DELETE') {
      var archivo = params.get('archivo') || '';
      if (archivo) { try { await FS().deleteFile({ path: dir + '/' + archivo, directory: DOCS }); } catch (e) {} }
      return J({ ok: true });
    }
  }

  // --- intercepción de fetch ---
  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var body = init && init.body;
    var parsed;
    try { parsed = new URL(url, location.href); } catch (e) { return _fetch(input, init); }
    var p = parsed.pathname.replace(/^\/+/, '');
    var params = parsed.searchParams;

    try {
      if (p === 'api/config') return await h_config(method, body);
      if (p === 'api/info') return h_info();
      if (p === 'api/fuentes') return h_fuentes();
      if (p === 'api/marcos') return await h_marcos(method, params, body);
      if (p.indexOf('api/marcos/') === 0 && method === 'DELETE')
        return await h_marcoDelete(decodeURIComponent(p.slice('api/marcos/'.length)));
      if (p === 'api/foto' && method === 'POST') return await h_foto(params, body);
      if (p === 'api/galeria') return await h_galeria(method, params);
    } catch (e) {
      return J({ error: String((e && e.message) || e) }, 500);
    }
    // cualquier otra cosa (assets locales): fetch normal
    return _fetch ? _fetch(input, init) : Promise.reject(new Error('sin red'));
  };

  // --- window.lic: puente que en Electron daba impresión/licencia. En Android: stubs ---
  window.lic = window.lic || {
    impresoras: function () { return Promise.resolve([]); },
    rotacionGet: function () { return Promise.resolve('no'); },
    rotacionSet: function () { return Promise.resolve(); },
    imprimir: function () { return Promise.resolve({ ok: true }); }, // sin impresión en Android
    estado: function () { return Promise.resolve({ activa: true, tipo: 'android' }); },
    info: function () { return Promise.resolve({ version: (window.SBF_VERSION || '1.0'), webUrl: '', correoSoporte: '', noticiasUrl: '' }); },
    infoConfig: function () { return Promise.resolve({ version: (window.SBF_VERSION || '1.0'), noticiasUrl: '' }); }
  };

  // Marca visual de que el adaptador cargó
  window.SBF_ANDROID = true;
})();
