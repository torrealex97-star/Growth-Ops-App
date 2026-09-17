// SOURCE del pixel first-party (gop.js → /tracker.js). Es un string porque la ruta
// app/tracker.js/route.ts lo sirve con headers de cache, y así los tests pueden fijar su
// comportamiento sin evaluar el bundle. Diseño (brief §9): identificador anónimo first-party,
// UTMs/click ids, eventos allowlistados, sin PII, y sin dependencias.
//
// Instalación:
//   <script defer src="https://tu-app.vercel.app/tracker.js" data-site="gop_pk_xxx"></script>
// Eventos manuales (CTAs, formularios, ventas):
//   window.gop('cta_click', { cta: 'reservar' })
//   window.gop('lead', { email: '...@...' })  // solo lo que el form ya envía al negocio
export const TRACKER_JS_VERSION = '1.0.0'

export const TRACKER_JS = String.raw`
(function () {
  'use strict'
  if (window.__gopLoaded) return
  window.__gopLoaded = true

  var VERSION = '${TRACKER_JS_VERSION}'
  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName('script')
      for (var i = all.length - 1; i >= 0; i--) {
        if (all[i].src && all[i].src.indexOf('/tracker.js') !== -1) return all[i]
      }
      return null
    })()
  var SITE = script && script.getAttribute('data-site')
  if (!SITE || !/^gop_pk_/.test(SITE)) return

  var ENDPOINT = script.src.replace(/\/tracker\.js.*$/, '/api/track/') + encodeURIComponent(SITE)
  var AID_KEY = 'gop_aid'
  var SID_KEY = 'gop_sid'
  var UTM_KEY = 'gop_utm'

  // ---- Identidad anónima first-party (sin PII) ----
  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0
      var v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }
  function anonId() {
    try {
      var v = localStorage.getItem(AID_KEY)
      if (!v) {
        v = uuid()
        localStorage.setItem(AID_KEY, v)
      }
      return v
    } catch (e) {
      return uuid() // storage bloqueado: identidad de sesión, sin persistencia
    }
  }
  function sessionId() {
    try {
      var v = sessionStorage.getItem(SID_KEY)
      if (!v) {
        v = uuid()
        sessionStorage.setItem(SID_KEY, v)
      }
      return v
    } catch (e) {
      return uuid()
    }
  }

  // ---- Atribución: UTMs y click ids de la URL (persistidos por sesión) ----
  var ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'ttclid']
  function currentAttrs() {
    var out = {}
    try {
      var params = new URLSearchParams(window.location.search)
      ATTR_KEYS.forEach(function (k) {
        var v = params.get(k)
        if (v) out[k] = v.slice(0, 200)
      })
      if (Object.keys(out).length > 0) sessionStorage.setItem(UTM_KEY, JSON.stringify(out))
      else {
        var saved = sessionStorage.getItem(UTM_KEY)
        if (saved) out = JSON.parse(saved)
      }
    } catch (e) {
      // Sin storage o JSON roto: seguimos sin atribución, nunca rompemos la página.
    }
    return out
  }

  // ---- Envío: sendBeacon si existe, fetch keepalive como fallback ----
  function send(event, props) {
    var attrs = currentAttrs()
    var payload = {
      event: event,
      event_id: uuid(),
      url: String(window.location.href).slice(0, 1000),
      referrer: document.referrer ? String(document.referrer).slice(0, 500) : '',
      anonymous_id: anonId(),
      session_id: sessionId(),
      properties: props || {},
    }
    ATTR_KEYS.forEach(function (k) {
      if (attrs[k]) payload[k] = attrs[k]
    })
    var body = JSON.stringify(payload)
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) return
    } catch (e) {
      // sendBeacon no disponible o bloqueado: el fetch de abajo es el fallback.
    }
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true,
      credentials: 'omit',
    }).catch(function () {
      // Error de red al mandar el evento: el pixel jamás interfiere con la página anfitriona.
    })
  }

  // ---- API pública ----
  window.gop = function (event, props) {
    if (!event || typeof event !== 'string') return
    send(event.replace(/[^a-z0-9_]/gi, '_').toLowerCase().slice(0, 60), props)
  }
  window.gop.version = VERSION

  // ---- Auto-track: page_view en carga y en navegación SPA (history API) ----
  var lastPath = window.location.pathname + window.location.search
  send('page_view')
  var wrap = function (name) {
    var original = history[name]
    history[name] = function () {
      var result = original.apply(this, arguments)
      var path = window.location.pathname + window.location.search
      if (path !== lastPath) {
        lastPath = path
        send('page_view')
      }
      return result
    }
  }
  wrap('pushState')
  wrap('replaceState')
  window.addEventListener('popstate', function () {
    var path = window.location.pathname + window.location.search
    if (path !== lastPath) {
      lastPath = path
      send('page_view')
    }
  })
})()
`
