const KORB = "https://korb.rk/jar";
const UA = "Lime/3.248.1 (iPhone; iOS 17.5; Scale/3.00)";

async function korbLesen(){
  const c = await caches.default.match(new Request(KORB));
  return c ? (await c.text()) : "";
}
async function korbSchreiben(res){
  let liste = [];
  try { liste = res.headers.getSetCookie() } catch(_){}
  if (!liste.length) return;
  const alt = await korbLesen();
  const map = {};
  alt.split(";").forEach(p => { const i = p.indexOf("="); if (i > 0) map[p.slice(0,i).trim()] = p.slice(i+1).trim() });
  liste.forEach(p => { const i = p.indexOf("="); if (i > 0) map[p.slice(0,i).trim()] = p.slice(i+1).trim() });
  const neu = Object.keys(map).filter(k => map[k]).map(k => k + "=" + map[k]).join("; ");
  await caches.default.put(new Request(KORB), new Response(neu, {
    headers: { "content-type":"text/plain", "cache-control":"max-age=3600" }
  }));
}

async function sitzung(){
  for (const z of [
    "https://web-production.lime.bike/api/rider/v2/onboarding/session",
    "https://lime.bike/"
  ]){
    try {
      const r = await fetch(z, { headers: {
        "accept":"application/json, text/plain, */*",
        "accept-language":"de-DE,de;q=0.9",
        "user-agent":UA,
        "origin":"https://web-production.lime.bike",
        "referer":"https://web-production.lime.bike/"
      }, redirect:"follow" });
      await korbSchreiben(r);
      const k = await korbLesen();
      if (k && /session/i.test(k)) return k;
    } catch(_){}
  }
  return "";
}

const WEG = ["host","cf-connecting-ip","cf-ray","cf-visitor","x-forwarded-proto",
  "origin","referer","accept-encoding","content-length","cookie","user-agent"];

export default {
  async fetch(req){
    const cors = {
      "access-control-allow-origin":"*",
      "access-control-allow-headers":"*",
      "access-control-allow-methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-max-age":"86400",
      "access-control-expose-headers":"retry-after,x-rk-session,x-rk-try"
    };
    if (req.method === "OPTIONS") return new Response(null, { status:204, headers:cors });

    const u = new URL(req.url);
    const ziel = u.searchParams.get("url");
    if (!ziel) return new Response(JSON.stringify({ fehler:"url fehlt" }),
      { status:400, headers:{ ...cors, "content-type":"application/json" } });

    let t;
    try { t = new URL(ziel) } catch(_){
      return new Response(JSON.stringify({ fehler:"url kaputt" }),
        { status:400, headers:{ ...cors, "content-type":"application/json" } });
    }

    const lime = /(^|\.)lime\.bike$/.test(t.hostname);
    const meth = req.method;
    const roh = meth === "HEAD" ? null : await req.arrayBuffer();
    const koerper = (roh && roh.byteLength) ? roh : undefined;

    const kopf = {};
    req.headers.forEach((v,k) => { if (WEG.indexOf(k) < 0) kopf[k] = v });
    kopf["user-agent"] = UA;

    if (lime){
      kopf["origin"] = "https://web-production.lime.bike";
      kopf["referer"] = "https://web-production.lime.bike/";
      kopf["accept-language"] = "de-DE,de;q=0.9";
      kopf["platform"] = "iOS";
      kopf["app-version"] = "3.248.1";
      let jar = await korbLesen();
      if (!jar) jar = await sitzung();
      if (jar) kopf["cookie"] = jar;
    }

    let versuche = 0, res;
    while (versuche < 3){
      versuche++;
      try {
        res = await fetch(t.toString(), { method:meth, headers:kopf, body:koerper, redirect:"follow" });
      } catch(e){
        res = new Response(JSON.stringify({ fehler:"upstream", detail:String(e) }),
          { status:502, headers:{ "content-type":"application/json" } });
      }
      if (lime) await korbSchreiben(res);
      if (!lime) break;
      if (res.status !== 429 && res.status !== 503 && res.status !== 521) break;
      if (versuche >= 3) break;
      const ra = parseInt(res.headers.get("retry-after") || "0", 10);
      await new Promise(r => setTimeout(r, ra > 0 ? Math.min(ra, 25) * 1000 : 2500 * versuche));
      const neu = await korbLesen();
      if (neu) kopf["cookie"] = neu;
    }

    const raus = new Headers(res.headers);
    ["content-encoding","content-length","transfer-encoding","set-cookie","cache-control"].forEach(k => raus.delete(k));
    for (const k in cors) raus.set(k, cors[k]);
    raus.set("cache-control", "no-store");
    raus.set("x-rk-session", lime ? ((await korbLesen()) ? "1" : "0") : "-");
    raus.set("x-rk-try", String(versuche));
    return new Response(res.body, { status:res.status, headers:raus });
  }
};