export const dynamic = 'force-dynamic'

// Script que se incrusta en la landing / página de GHL. Hace dos cosas:
//  1) Expone window.tccVSL.identify(email) para asociar el lead manualmente.
//  2) AUTO-captura el lead del funnel: lee email/nombre desde los parámetros de la URL
//     (?email=...&name=...) o desde window.tccVSLLead, y llama a identify solo.
export async function GET() {
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://app.iawinners.com'
  const origin = site.replace(/\/$/, '')

  const js = `(function(){
  var ORIGIN = ${JSON.stringify(origin)};
  var pending = null;
  function frames(){
    var out = [];
    var list = document.querySelectorAll('iframe');
    for (var i=0;i<list.length;i++){
      var src = list[i].getAttribute('src') || '';
      if (src.indexOf(ORIGIN + '/embed/vsl/') === 0 || src.indexOf('/embed/vsl/') === 0) out.push(list[i]);
    }
    return out;
  }
  function send(payload){
    frames().forEach(function(f){
      try { f.contentWindow.postMessage(Object.assign({ __tccvsl: 'identify' }, payload), '*'); } catch(e){}
    });
  }
  function bad(v){ return !v || v.indexOf('{{') !== -1 || v.indexOf('}}') !== -1; }
  window.tccVSL = window.tccVSL || {};
  window.tccVSL.identify = function(data){
    var payload = (typeof data === 'string') ? { email: data } : (data || {});
    // Ignora merge fields sin resolver (p.ej. GHL manda "{{contact.email}}" literal).
    if (bad(payload.email)) delete payload.email;
    if (bad(payload.name)) delete payload.name;
    if (!payload.email && !payload.name) return;
    pending = payload;
    send(payload);
  };

  // --- Enganche del visionado ANÓNIMO con la cita (leads sin optin) -----------
  // El player nos manda su anonId. Lo inyectamos como salesforce_uuid en los enlaces
  // y widgets de Calendly de la página, para que Calendly lo reenvíe en el webhook y
  // el servidor pueda asociar el % visto a la cita aunque el lead nunca se registrara.
  var anonId = null;
  function addParam(url, val){
    if (!url || url.indexOf('salesforce_uuid=') !== -1) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'salesforce_uuid=' + encodeURIComponent(val);
  }
  function decorateCalendly(){
    if (!anonId) return;
    // Enlaces / botones que llevan a calendly.com
    var links = document.querySelectorAll('a[href*="calendly.com"], [data-url*="calendly.com"]');
    for (var i=0;i<links.length;i++){
      var el = links[i];
      if (el.getAttribute('href') && el.getAttribute('href').indexOf('calendly.com') !== -1)
        el.setAttribute('href', addParam(el.getAttribute('href'), anonId));
      if (el.getAttribute('data-url') && el.getAttribute('data-url').indexOf('calendly.com') !== -1)
        el.setAttribute('data-url', addParam(el.getAttribute('data-url'), anonId));
    }
  }
  window.tccVSL.anonId = function(){ return anonId; };
  window.tccVSL.bookingParam = function(){ return anonId ? { salesforce_uuid: anonId } : {}; };

  // Reenvía a iframes que carguen después (cuando avisan 'ready') y capta el anonId.
  window.addEventListener('message', function(e){
    if (!e.data || e.data.__tccvsl !== 'ready') return;
    if (e.data.anonId){ anonId = e.data.anonId; try { decorateCalendly(); } catch(_){} }
    if (pending) { try { e.source.postMessage(Object.assign({ __tccvsl: 'identify' }, pending), '*'); } catch(_){} }
  });
  // Re-decora si Calendly se inyecta después (widgets que cargan async).
  try {
    var mo = new MutationObserver(function(){ decorateCalendly(); });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', function(){ mo.observe(document.body, { childList: true, subtree: true }); });
  } catch(_){}
  // AUTO-captura: combina window.tccVSLLead (si sus valores son válidos) con los
  // parámetros de la URL del funnel. Si tccVSLLead trae merge fields sin resolver
  // ("{{contact.email}}"), se ignoran y se cae a la URL igualmente.
  function ok(v){ return (v && v.indexOf('{{') === -1 && v.indexOf('}}') === -1) ? v : null; }
  function autoCapture(){
    var lead = window.tccVSLLead || {};
    var email = ok(lead.email);
    var name  = ok(lead.name);
    try {
      var q = new URLSearchParams(window.location.search);
      if (!email) email = q.get('email') || q.get('lead_email') || q.get('contact_email') || q.get('e');
      if (!name)  name  = q.get('name')  || q.get('first_name') || q.get('full_name') || q.get('fname');
    } catch(_){}
    if (email || name) window.tccVSL.identify({ email: email || undefined, name: name || undefined });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoCapture);
  else autoCapture();
})();`

  return new Response(js, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  })
}
