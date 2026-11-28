/* =====================================================================
   StripBoothFoto · Adaptador Android (Capacitor)
   Reemplaza el servidor interno (Node) por almacenamiento del dispositivo.
   - Intercepta api/*  (config, info, fuentes, marcos, foto, galeria)
   - Define window.lic (sin impresión)
   - Guardado:
       · Si el usuario eligió una carpeta (SAF, plugin FolderSaf), guarda ahí:
             <carpeta>/<evento>/tira_*.jpg
             <carpeta>/<evento>/originales/original_*.jpg
       · Si no, guarda en  Documentos/StripBoothFoto/<evento>/ (respaldo).
   - window.SBF.pickFolder()   -> elegir carpeta
   - window.SBF.carpetaActual()-> {uri,name} o null
   - window.SBF.galeriaSrc()   -> data URL de una tira (para miniaturas)
   ===================================================================== */
(function () {
  'use strict';

  var APP_DIR = 'StripBoothFoto';
  var MARCOS_DIR = 'marcos';
  var CFG_KEY = 'sbf_config';
  var CARPETA_KEY = 'sbf_carpeta';
  var DOCS = 'DOCUMENTS';
  var DATA = 'DATA';
  // Novedades y promociones: misma página que en la versión de PC.
  var NEWS_URL = 'https://artefgo.com/news/SBFnews.html';
  var WEB_URL = 'https://artefgo.com';

  function plugins() { return (window.Capacitor && window.Capacitor.Plugins) || {}; }
  function FS() { return plugins().Filesystem; }
  function PREFS() { return plugins().Preferences; }
  function SAF() { return plugins().FolderSaf; }

  var galeriaCache = {}; // nombre -> uri (cuando se usa SAF)

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
    try { await FS().mkdir({ path: dir, directory: directory, recursive: true }); } catch (e) {}
  }
  async function getCarpeta() {
    try { var g = await PREFS().get({ key: CARPETA_KEY }); var o = g && g.value ? JSON.parse(g.value) : null; return (o && o.uri) ? o : null; }
    catch (e) { return null; }
  }

  // --- marcos como data URL (para img.src en Android) ---
  window.marcoUrl = async function (nombre) {
    try {
      var r = await FS().readFile({ path: MARCOS_DIR + '/' + nombre, directory: DATA });
      var ext = (nombre.split('.').pop() || 'png').toLowerCase();
      var mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/png';
      return 'data:' + mime + ';base64,' + r.data;
    } catch (e) {
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    }
  };

  // --- API pública para la interfaz ---
  window.SBF = {
    pickFolder: async function () {
      if (!SAF()) throw new Error('Selector de carpeta no disponible');
      var r = await SAF().pickFolder(); // {uri,name}
      try { await PREFS().set({ key: CARPETA_KEY, value: JSON.stringify({ uri: r.uri, name: r.name || '' }) }); } catch (e) {}
      return r;
    },
    carpetaActual: getCarpeta,
    galeriaSrc: async function (ev, nombre) {
      try {
        var carpeta = await getCarpeta();
        if (carpeta && SAF()) {
          var uri = galeriaCache[nombre];
          if (!uri) {
            var rl = await SAF().listFiles({ folderUri: carpeta.uri, subPath: limpiar(ev) });
            (rl.files || []).forEach(function (f) { if (f.name === nombre) uri = f.uri; });
          }
          if (!uri) return '';
          var rf = await SAF().readFile({ uri: uri });
          return 'data:image/jpeg;base64,' + rf.data;
        }
        var r = await FS().readFile({ path: APP_DIR + '/' + limpiar(ev) + '/' + nombre, directory: DOCS });
        return 'data:image/jpeg;base64,' + r.data;
      } catch (e) { return ''; }
    }
  };

  // --- manejadores de endpoints ---
  async function h_config(method, body) {
    if (method === 'GET') {
      try { var g = await PREFS().get({ key: CFG_KEY }); return J(g && g.value ? JSON.parse(g.value) : {}); }
      catch (e) { return J({}); }
    }
    var txt = typeof body === 'string' ? body : await (await bodyToBlob(body)).text();
    try { await PREFS().set({ key: CFG_KEY, value: txt }); } catch (e) {}
    return J({ ok: true });
  }

  function h_info() {
    return J({ ips: [], puerto: 0, equipo: 'Android', carpeta: 'carpeta del evento', version: (window.SBF_VERSION || '1.0') });
  }
  function h_fuentes() { return J([]); }

  async function h_marcos(method, params, body) {
    if (method === 'GET') {
      try {
        await ensureDir(MARCOS_DIR, DATA);
        var r = await FS().readdir({ path: MARCOS_DIR, directory: DATA });
        var files = (r.files || []).map(function (f) { return typeof f === 'string' ? { name: f } : f; });
        return J(files.filter(function (f) { return /\.(png|jpe?g|webp)$/i.test(f.name); })
          .map(function (f) { return { nombre: f.name, tam: f.size || 0, fecha: f.mtime || Date.now() }; })
          .sort(function (a, b) { return a.nombre.localeCompare(b.nombre); }));
      } catch (e) { return J([]); }
    }
    // POST
    var original = params.get('nombre') || 'marco.png';
    var m = original.toLowerCase().match(/\.(png|jpe?g|webp)$/);
    var ext = m ? m[0] : '.png';
    var base = limpiar(original.replace(/\.(png|jpe?g|webp)$/i, '')) || 'marco';
    await ensureDir(MARCOS_DIR, DATA);
    var nombre = base + ext, i = 2;
    try {
      var ex = await FS().readdir({ path: MARCOS_DIR, directory: DATA });
      var names = (ex.files || []).map(function (f) { return typeof f === 'string' ? f : f.name; });
      while (names.indexOf(nombre) !== -1) { nombre = base + '_' + (i++) + ext; }
    } catch (e) {}
    var b64 = await blobToB64(await bodyToBlob(body));
    await FS().writeFile({ path: MARCOS_DIR + '/' + nombre, data: b64, directory: DATA, recursive: true });
    return J({ nombre: nombre });
  }

  async function h_marcoDelete(nombre) {
    try { await FS().deleteFile({ path: MARCOS_DIR + '/' + nombre, directory: DATA }); } catch (e) {}
    return J({ ok: true });
  }

  async function h_foto(params, body) {
    var evento = limpiar(params.get('evento')) || 'Evento';
    var tipo = params.get('tipo') === 'original' ? 'original' : 'tira';
    var n = limpiar(params.get('n') || '');
    var nombre = tipo + '_' + sello() + (n ? '_' + n : '') + '_' + rnd() + '.jpg';
    var b64 = await blobToB64(await bodyToBlob(body));
    var carpeta = await getCarpeta();
    if (carpeta && SAF()) {
      var sub = tipo === 'original' ? evento + '/originales' : evento;
      await SAF().saveFile({ folderUri: carpeta.uri, subPath: sub, fileName: nombre, data: b64, mime: 'image/jpeg' });
    } else {
      var baseDir = APP_DIR + '/' + evento;
      var dir = tipo === 'original' ? baseDir + '/originales' : baseDir;
      await ensureDir(dir, DOCS);
      await FS().writeFile({ path: dir + '/' + nombre, data: b64, directory: DOCS, recursive: true });
    }
    return J({ evento: evento, archivo: nombre, pagina: '' });
  }

  async function h_galeria(method, params) {
    var evento = limpiar(params.get('evento'));
    var carpeta = await getCarpeta();
    if (method === 'GET') {
      try {
        if (carpeta && SAF()) {
          var r = await SAF().listFiles({ folderUri: carpeta.uri, subPath: evento });
          var tiras = (r.files || []).filter(function (f) { return /^tira_.*\.jpg$/i.test(f.name); });
          tiras.sort(function (a, b) { return (b.mtime || 0) - (a.mtime || 0); });
          galeriaCache = {}; tiras.forEach(function (f) { galeriaCache[f.name] = f.uri; });
          return J(tiras.map(function (f) { return f.name; }));
        }
        var rr = await FS().readdir({ path: APP_DIR + '/' + evento, directory: DOCS });
        var names = (rr.files || []).map(function (f) { return typeof f === 'string' ? f : f.name; });
        return J(names.filter(function (f) { return /^tira_.*\.jpg$/i.test(f); }).sort().reverse());
      } catch (e) { return J([]); }
    }
    // DELETE
    var archivo = params.get('archivo') || '';
    if (archivo) {
      try {
        if (carpeta && SAF()) {
          var uri = galeriaCache[archivo];
          if (!uri) {
            var rl = await SAF().listFiles({ folderUri: carpeta.uri, subPath: evento });
            (rl.files || []).forEach(function (f) { if (f.name === archivo) uri = f.uri; });
          }
          if (uri) await SAF().deleteFile({ uri: uri });
        } else {
          await FS().deleteFile({ path: APP_DIR + '/' + evento + '/' + archivo, directory: DOCS });
        }
      } catch (e) {}
    }
    return J({ ok: true });
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
    return _fetch ? _fetch(input, init) : Promise.reject(new Error('sin red'));
  };

  // --- window.lic: stubs en Android (sin impresión/licencia) ---
  window.lic = window.lic || {
    impresoras: function () { return Promise.resolve([]); },
    rotacionGet: function () { return Promise.resolve('no'); },
    rotacionSet: function () { return Promise.resolve(); },
    imprimir: function () { return Promise.resolve({ ok: true }); },
    estado: function () { return Promise.resolve({ activa: true, tipo: 'android' }); },
    abrirUrl: function (u) { try { window.open(String(u), '_blank'); } catch (e) {} return Promise.resolve({ abierto: true }); },
    abrirWeb: function () { try { window.open(WEB_URL, '_blank'); } catch (e) {} return Promise.resolve({ abierto: true }); },
    info: function () { return Promise.resolve({ version: (window.SBF_VERSION || '1.0'), webUrl: WEB_URL, correoSoporte: 'soporte@artefgo.com', noticiasUrl: NEWS_URL }); },
    infoConfig: function () { return Promise.resolve({ version: (window.SBF_VERSION || '1.0'), noticiasUrl: NEWS_URL }); }
  };

  window.SBF_ANDROID = true;

  // --- Adaptar la interfaz para Android (sin impresión; con selector de carpeta) ---
  document.addEventListener('DOMContentLoaded', function () {
    try {
      // Ocultar botón Imprimir
      var pb = document.getElementById('printBtn'); if (pb) pb.style.display = 'none';

      // --- Pestaña 06: convertir "QR y descarga" en "Vista previa" ---
      // En Android no hay QR de descarga por WiFi; en su lugar el menú 06
      // muestra cómo va quedando la tira (diseño elegido + texto).
      try { window.renderQR = function () {}; } catch (e) {}   // sin servidor QR en Android
      var qrTab = document.querySelector('[data-tab="qr"]');
      if (qrTab) { qrTab.style.display = ''; qrTab.innerHTML = '<i>06</i>Vista previa'; }
      var qrPane = document.querySelector('[data-pane="qr"]');
      var aside = document.querySelector('aside.preview');
      if (qrPane) {
        qrPane.style.display = '';
        qrPane.innerHTML =
          '<h1>Vista previa</h1>' +
          '<p class="lead">Así va quedando la tira con el diseño y el texto que elegiste. ' +
          'Se actualiza sola cuando cambias la personalización en los menús anteriores.</p>';
        if (aside) {
          var h3 = aside.querySelector('h3'); if (h3) h3.style.display = 'none';
          aside.style.display = 'flex';
          aside.style.border = 'none';
          aside.style.background = 'transparent';
          aside.style.padding = '0';
          aside.style.alignItems = 'center';
          var pv = document.getElementById('pv');
          if (pv) { pv.style.maxWidth = '100%'; pv.style.maxHeight = '72vh'; pv.style.height = 'auto'; pv.style.borderRadius = '10px'; pv.style.boxShadow = '0 6px 24px rgba(0,0,0,.18)'; }
          qrPane.appendChild(aside);
        }
      }
      // Renombrar 05 Impresión -> Guardado
      var impTab = document.querySelector('[data-tab="impresion"]'); if (impTab) impTab.innerHTML = '<i>05</i>Guardado';
      var imp = document.querySelector('[data-pane="impresion"]');
      if (imp) {
        var h = imp.querySelector('h1'); if (h) h.textContent = 'Guardado';
        var panel = imp.querySelector('.panel'); if (panel) panel.style.display = 'none';
        var nuevo = document.createElement('div');
        nuevo.className = 'panel';
        nuevo.innerHTML =
          '<label class="f">Carpeta donde se guardan las fotos</label>' +
          '<p class="note">Cada sesión guarda la <b>tira</b> y las <b>fotos sueltas</b> en la carpeta que elijas, dentro de una subcarpeta con el nombre del evento. Luego copias esa carpeta a tu PC.</p>' +
          '<div class="row" style="align-items:center;gap:10px">' +
          '  <button class="abtn" id="sbfPickBtn">Elegir carpeta…</button>' +
          '  <span class="note" id="sbfCarpetaNom" style="margin:0">Ninguna · se usa Documentos/StripBoothFoto</span>' +
          '</div>';
        imp.insertBefore(nuevo, panel);
        window.SBF.carpetaActual().then(function (c) {
          if (c && c.name) { var el = document.getElementById('sbfCarpetaNom'); if (el) el.textContent = '📁 ' + c.name; }
        });
        var btn = document.getElementById('sbfPickBtn');
        if (btn) btn.onclick = async function () {
          try { var r = await window.SBF.pickFolder(); var el = document.getElementById('sbfCarpetaNom'); if (el) el.textContent = '📁 ' + (r.name || 'Carpeta elegida'); }
          catch (e) { /* cancelado */ }
        };
      }
    } catch (e) {}
  });
})();
