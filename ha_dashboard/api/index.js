// Express backend — proxies REST calls to Home Assistant.
// Keeps the long-lived access token server-side so it never reaches the browser.

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// override:true so .env is authoritative for PORT even when a parent process
// (e.g. a preview/launcher harness) injects its own PORT env var.
dotenv.config({ override: true });

// Resilience: a dropped camera stream, a client reset, or an HA socket hiccup
// must be logged — never crash the whole proxy. (api/dev-server.mjs additionally
// restarts the process if it ever does exit.)
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err?.stack || err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err?.stack || err));

const app = express();
const PORT = process.env.PORT || 3001;
const HA_BASE_URL = (process.env.HA_BASE_URL || '').replace(/\/$/, '');
const HA_TOKEN = process.env.HA_TOKEN;

if (!HA_BASE_URL || !HA_TOKEN || HA_TOKEN === 'PASTE_TOKEN_HERE') {
  console.warn('⚠️  HA_BASE_URL or HA_TOKEN missing/placeholder in .env — API calls will fail.');
}

app.use(cors());
app.use(express.json());

// ---- Helper: forward a request to Home Assistant ----
async function haFetch(path, options = {}) {
  const url = `${HA_BASE_URL}/api${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${HA_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const err = new Error(`HA ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// ---- Health / connectivity check ----
app.get('/api/health', async (_req, res) => {
  try {
    const data = await haFetch('/');
    res.json({ ok: true, ha: data, base: HA_BASE_URL });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message, base: HA_BASE_URL });
  }
});

// ---- All entity states ----
// Frontend filters into lights / switches / sensors / scenes / climate by domain prefix.
app.get('/api/states', async (_req, res) => {
  try {
    const states = await haFetch('/states');
    res.json(states);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---- Single entity state ----
app.get('/api/states/:entityId', async (req, res) => {
  try {
    const data = await haFetch(`/states/${encodeURIComponent(req.params.entityId)}`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---- History (for charts) ----
// GET /api/history?entities=sensor.a,sensor.b&start=<ISO>
app.get('/api/history', async (req, res) => {
  try {
    const { entities, start } = req.query;
    if (!entities || !start) return res.status(400).json({ error: 'entities and start required' });
    const path = `/history/period/${encodeURIComponent(start)}?filter_entity_id=${encodeURIComponent(entities)}&minimal_response&no_attributes`;
    res.json(await haFetch(path));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---- Call any HA service ----
// POST /api/service/light/turn_on  { entity_id: "light.kitchen", brightness: 200 }
app.post('/api/service/:domain/:service', async (req, res) => {
  try {
    const { domain, service } = req.params;
    const data = await haFetch(`/services/${domain}/${service}`, {
      method: 'POST',
      body: JSON.stringify(req.body || {}),
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---- List configured services (domains + services) ----
app.get('/api/services', async (_req, res) => {
  try {
    const data = await haFetch('/services');
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---- Scene config CRUD ----
// HA exposes UI-editable scenes via /api/config/scene/config/<id>
// Body format: { name, icon?, entities: { "light.x": { state: "on", brightness: 200 }, ... } }
app.get('/api/scenes/:id/config', async (req, res) => {
  try {
    const data = await haFetch(`/config/scene/config/${encodeURIComponent(req.params.id)}`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/scenes/:id/config', async (req, res) => {
  try {
    const data = await haFetch(`/config/scene/config/${encodeURIComponent(req.params.id)}`, {
      method: 'POST',
      body: JSON.stringify(req.body || {}),
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/scenes/:id/config', async (req, res) => {
  try {
    const data = await haFetch(`/config/scene/config/${encodeURIComponent(req.params.id)}`, {
      method: 'DELETE',
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Apply states without saving — preview a scene
app.post('/api/scenes/preview', async (req, res) => {
  try {
    const data = await haFetch('/services/scene/apply', {
      method: 'POST',
      body: JSON.stringify(req.body || {}),
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Reload HA's scene config so newly-saved scenes appear without a HA restart
app.post('/api/scenes/reload', async (_req, res) => {
  try {
    const data = await haFetch('/services/scene/reload', { method: 'POST', body: '{}' });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---- Automation config CRUD ----
// HA exposes UI-editable automations via /api/config/automation/config/<id>
// Body format mirrors automations.yaml: { alias, description?, trigger: [...],
//   condition: [...], action: [...], mode: 'single'|'parallel'|'queued'|'restart' }
app.get('/api/automations/:id/config', async (req, res) => {
  try {
    const data = await haFetch(`/config/automation/config/${encodeURIComponent(req.params.id)}`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/automations/:id/config', async (req, res) => {
  try {
    const data = await haFetch(`/config/automation/config/${encodeURIComponent(req.params.id)}`, {
      method: 'POST',
      body: JSON.stringify(req.body || {}),
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/automations/:id/config', async (req, res) => {
  try {
    const data = await haFetch(`/config/automation/config/${encodeURIComponent(req.params.id)}`, {
      method: 'DELETE',
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/automations/reload', async (_req, res) => {
  try {
    const data = await haFetch('/services/automation/reload', { method: 'POST', body: '{}' });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---- Entity registry (over WebSocket), cached ----
// The REST API can't tell us an entity's category, but a "primary controls"
// view needs to hide config/diagnostic/hidden/disabled entities (e.g. the
// dozens of camera detection + overlay switches). The registry has that, so we
// fetch it once via the WebSocket API and cache it.
let regCache = null;
let regAt = 0;

function fetchEntityRegistry() {
  return new Promise((resolve, reject) => {
    const wsUrl = `${HA_BASE_URL.replace(/^http/, 'ws')}/api/websocket`;
    let ws;
    try { ws = new WebSocket(wsUrl); }
    catch (e) { return reject(e); }
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('registry ws timeout')); }, 10000);
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', access_token: HA_TOKEN }));
      } else if (msg.type === 'auth_invalid') {
        clearTimeout(timer); try { ws.close(); } catch {} reject(new Error('registry auth_invalid'));
      } else if (msg.type === 'auth_ok') {
        ws.send(JSON.stringify({ id: 1, type: 'config/entity_registry/list' }));
      } else if (msg.type === 'result' && msg.id === 1) {
        clearTimeout(timer); try { ws.close(); } catch {}
        if (!msg.success) return reject(new Error('registry list failed'));
        resolve(msg.result || []);
      }
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('registry ws error')); });
  });
}

async function getRegistryMap() {
  if (regCache && Date.now() - regAt < 60000) return regCache;
  const list = await fetchEntityRegistry();
  regCache = new Map(list.map((e) => [e.entity_id, e]));
  regAt = Date.now();
  return regCache;
}

// ---- Areas (rooms) with their PRIMARY entity ids ----
// area_entities() (template) resolves area membership including entities that
// inherit their area from their device. We then filter to primary entities
// using the registry (drop config/diagnostic/hidden/disabled). Fails open: if
// the registry can't be read, all entities are returned.
app.get('/api/areas', async (_req, res) => {
  try {
    const template = [
      '[',
      '{%- for a in areas() -%}',
      '{"area_id": {{ a | tojson }}, "name": {{ area_name(a) | tojson }}, "entities": {{ area_entities(a) | tojson }}}',
      '{%- if not loop.last -%},{%- endif -%}',
      '{%- endfor -%}',
      ']',
    ].join('');
    const rendered = await haFetch('/template', {
      method: 'POST',
      body: JSON.stringify({ template }),
    });
    let areas = rendered;
    if (typeof rendered === 'string') {
      try { areas = JSON.parse(rendered); }
      catch { throw new Error(`Template did not return JSON: ${rendered.slice(0, 200)}`); }
    }

    const reg = await getRegistryMap().catch((e) => {
      console.warn('[areas] registry unavailable, returning unfiltered:', e.message);
      return null;
    });
    const isPrimary = (id) => {
      if (!reg) return true;            // fail open
      const e = reg.get(id);
      if (!e) return true;              // YAML/unregistered entity — keep
      return !e.entity_category && !e.hidden_by && !e.disabled_by;
    };
    areas = areas.map((a) => ({
      ...a,
      total: (a.entities || []).length,
      entities: (a.entities || []).filter(isPrimary),
    }));

    res.json(areas);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---- Camera snapshot ----
// Proxies HA's /api/camera_proxy/<entity> (a single JPEG) so an <img> can load
// it without the token ever reaching the browser. Cache-busted by the client.
app.get('/api/camera/:entityId/snapshot', async (req, res) => {
  try {
    const url = `${HA_BASE_URL}/api/camera_proxy/${encodeURIComponent(req.params.entityId)}`;
    const upstream = await fetch(url, { headers: { Authorization: `Bearer ${HA_TOKEN}` } });
    if (!upstream.ok) return res.status(upstream.status).end();
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ---- Camera live stream (MJPEG) ----
// Proxies HA's /api/camera_proxy_stream/<entity> (multipart/x-mixed-replace).
// Piped straight through; aborts the upstream when the client disconnects so we
// don't leak open streams.
app.get('/api/camera/:entityId/stream', async (req, res) => {
  const controller = new AbortController();
  const abort = () => { try { controller.abort(); } catch {} };
  req.on('close', abort);
  res.on('error', abort); // client reset mid-stream must not bubble to uncaughtException
  try {
    const url = `${HA_BASE_URL}/api/camera_proxy_stream/${encodeURIComponent(req.params.entityId)}`;
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${HA_TOKEN}` },
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) return res.status(upstream.status || 502).end();
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'multipart/x-mixed-replace');
    res.setHeader('Cache-Control', 'no-store');
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => {
          res.once('drain', resolve);
          res.once('close', resolve);
          res.once('error', resolve);
        });
      }
    }
    res.end();
  } catch (err) {
    if (err.name !== 'AbortError' && !res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      try { res.end(); } catch {}
    }
  }
});

// ---- Doorbell thumbnail cache ----
// A Nest doorbell's camera_proxy snapshot is usually a black "no media"
// placeholder, and a live stream costs battery. So we cache a real still here:
// the browser uploads a frame whenever someone views live (free — they're
// already streaming), or a bright event-snapshot when the bell rings. The wall
// tile / dashboard then shows this without ever waking the camera.
const doorbellThumbs = new Map(); // entityId -> { buf, type, at }

app.post('/api/camera/:entityId/thumbnail', express.raw({ type: 'image/*', limit: '5mb' }), (req, res) => {
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty body' });
  doorbellThumbs.set(req.params.entityId, {
    buf: req.body,
    type: req.headers['content-type'] || 'image/jpeg',
    at: Date.now(),
  });
  res.json({ ok: true, bytes: req.body.length });
});

app.get('/api/camera/:entityId/thumbnail', (req, res) => {
  const t = doorbellThumbs.get(req.params.entityId);
  if (!t) return res.status(404).end();
  res.setHeader('Content-Type', t.type);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Thumbnail-At', String(t.at));
  res.end(t.buf);
});

// ---- Media player favourites (browse_media over WebSocket) ----
// Returns a speaker's playable favourites (Sonos favourites, Cast items) so the
// dashboard can start music. Browses the root, finds the "Favorites" node, and
// returns its playable children. Uses the same WS helper as the WebRTC relay.
app.get('/api/media/:entityId/favorites', async (req, res) => {
  let ha;
  try {
    ha = await openHaSocket();
    const entity_id = req.params.entityId;
    const browse = (id, type) =>
      ha.send({ type: 'media_player/browse_media', entity_id, ...(id !== undefined ? { media_content_id: id, media_content_type: type } : {}) });
    const root = await browse();
    const favNode = (root.result?.children || []).find((c) => /favorit/i.test(c.title || '') || /favorit/i.test(c.media_content_type || ''));
    const out = [];
    const push = (c, folder) => out.push({ title: c.title, media_content_id: c.media_content_id, media_content_type: c.media_content_type, thumbnail: c.thumbnail || null, folder: folder || null });
    if (favNode) {
      const fav = await browse(favNode.media_content_id, favNode.media_content_type);
      for (const child of fav.result?.children || []) {
        if (child.can_play) push(child);
        else if (child.can_expand) {
          // Sonos nests favourites in Playlists / Radio / Tracks folders.
          const sub = await browse(child.media_content_id, child.media_content_type);
          for (const item of sub.result?.children || []) if (item.can_play) push(item, child.title);
        }
      }
    }
    res.json(out.slice(0, 60));
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    ha?.close();
  }
});

// ---- Radio Browser stations (quick "play radio" picker, works on any speaker) ----
// Browses a media-source node (default: local = the HA-configured country, i.e.
// Australia here) and returns playable stations. play_media resolves the stream.
app.get('/api/media/:entityId/radio', async (req, res) => {
  let ha;
  try {
    ha = await openHaSocket();
    const entity_id = req.params.entityId;
    const node = req.query.id || 'media-source://radio_browser/local';
    const r = await ha.send({ type: 'media_player/browse_media', entity_id, media_content_id: node, media_content_type: 'music' });
    const items = (r.result?.children || [])
      .filter((c) => c.can_play)
      .map((c) => ({ title: c.title, media_content_id: c.media_content_id, media_content_type: c.media_content_type, thumbnail: c.thumbnail || null }));
    res.json(items.slice(0, 80));
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    ha?.close();
  }
});

// ---- Weather forecast (get_forecasts service, returns response data) ----
// The forecast attribute was removed from weather entities; you now call the
// service. We relay it over the WS API (REST can't return service response data).
app.get('/api/weather/:entityId/forecast', async (req, res) => {
  let ha;
  try {
    ha = await openHaSocket();
    const entity_id = req.params.entityId;
    const r = await ha.send({
      type: 'call_service', domain: 'weather', service: 'get_forecasts',
      service_data: { type: req.query.type || 'daily' }, target: { entity_id }, return_response: true,
    });
    res.json(r.result?.response?.[entity_id]?.forecast || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    ha?.close();
  }
});

// ---- WebRTC signaling relay (for Nest/WebRTC-only cameras) ----
// Nest cameras only stream over WebRTC. HA's new `camera/webrtc/offer` is a
// WebSocket subscription (offer in -> session/answer/candidate events out, plus
// `camera/webrtc/candidate` for client trickle). We relay that through here so
// the token stays server-side, and we keep the HA subscription OPEN for the life
// of the view (closing it tears down the stream). Media itself is P2P via TURN.

import crypto from 'crypto';

function openHaSocket() {
  return new Promise((resolve, reject) => {
    const wsUrl = `${HA_BASE_URL.replace(/^http/, 'ws')}/api/websocket`;
    let ws;
    try { ws = new WebSocket(wsUrl); } catch (e) { return reject(e); }
    let nextId = 1;
    const pending = {};
    const subs = {};
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('ha ws auth timeout')); }, 15000);
    const api = {
      closed: false,
      send(msg) {
        const id = nextId++;
        msg.id = id;
        return new Promise((res, rej) => { pending[id] = { res, rej }; ws.send(JSON.stringify(msg)); });
      },
      subscribe(msg, onEvent) {
        const id = nextId++;
        msg.id = id;
        subs[id] = onEvent;
        return new Promise((res, rej) => { pending[id] = { res, rej, keep: true }; ws.send(JSON.stringify(msg)); });
      },
      fireAndForget(msg) { msg.id = nextId++; ws.send(JSON.stringify(msg)); },
      close() { try { ws.close(); } catch {} },
    };
    ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'auth_required') { ws.send(JSON.stringify({ type: 'auth', access_token: HA_TOKEN })); return; }
      if (m.type === 'auth_invalid') { clearTimeout(timer); api.close(); reject(new Error('auth_invalid')); return; }
      if (m.type === 'auth_ok') { clearTimeout(timer); resolve(api); return; }
      if (m.type === 'result' && pending[m.id]) {
        const p = pending[m.id];
        if (!p.keep || !m.success) delete pending[m.id];
        if (m.success) p.res(m);
        else p.rej(Object.assign(new Error(m.error?.message || 'ws error'), { ha: m.error }));
      } else if (m.type === 'event' && subs[m.id]) {
        subs[m.id](m.event);
      }
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('ha ws error')); });
    ws.addEventListener('close', () => { api.closed = true; });
  });
}

const webrtcSessions = new Map(); // ourId -> { ha, haSessionId, entityId, createdAt }
const WEBRTC_TTL_MS = 10 * 60 * 1000;
function closeWebrtcSession(id) {
  const s = webrtcSessions.get(id);
  if (!s) return;
  webrtcSessions.delete(id);
  s.ha.close();
}

// ICE servers (STUN/TURN) the browser must use to reach the camera.
app.get('/api/camera/:entityId/webrtc/config', async (req, res) => {
  let ha;
  try {
    ha = await openHaSocket();
    const r = await ha.send({ type: 'camera/webrtc/get_client_config', entity_id: req.params.entityId });
    res.json(r.result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    ha?.close();
  }
});

// Send the browser's SDP offer; return the answer + any server ICE candidates
// gathered in a short window. Keeps the HA session open (returns sessionId).
app.post('/api/camera/:entityId/webrtc/offer', async (req, res) => {
  const offer = req.body?.offer;
  if (!offer) return res.status(400).json({ error: 'missing offer' });
  let ha;
  try {
    ha = await openHaSocket();
    const result = await new Promise((resolve, reject) => {
      const candidates = [];
      let answer = null, haSessionId = null, settled = false, answerTimer = null;
      const hard = setTimeout(() => (answer ? finish() : fail(new Error('no answer from HA within timeout'))), 12000);
      function finish() {
        if (settled) return;
        settled = true; clearTimeout(hard); clearTimeout(answerTimer);
        resolve({ answer, candidates, haSessionId });
      }
      function fail(e) {
        if (settled) return;
        settled = true; clearTimeout(hard); clearTimeout(answerTimer); reject(e);
      }
      ha.subscribe({ type: 'camera/webrtc/offer', entity_id: req.params.entityId, offer }, (event) => {
        if (!event || !event.type) return;
        switch (event.type) {
          case 'session': haSessionId = event.session_id; break;
          case 'answer':
            answer = typeof event.answer === 'string' ? event.answer : event.answer?.sdp;
            clearTimeout(answerTimer);
            answerTimer = setTimeout(finish, 3500); // brief window to batch server candidates
            break;
          case 'candidate': candidates.push(event.candidate); break;
          case 'error': fail(Object.assign(new Error(event.message || 'webrtc error'), { code: event.code })); break;
          default: break;
        }
      }).catch(fail);
    });

    const id = crypto.randomUUID();
    webrtcSessions.set(id, { ha, haSessionId: result.haSessionId, entityId: req.params.entityId, createdAt: Date.now() });
    setTimeout(() => closeWebrtcSession(id), WEBRTC_TTL_MS);
    res.json({ sessionId: id, answer: result.answer, candidates: result.candidates });
  } catch (err) {
    ha?.close();
    res.status(502).json({ error: err.message, code: err.code });
  }
});

// Trickle a browser ICE candidate to HA for an open session.
app.post('/api/camera/:entityId/webrtc/candidate', (req, res) => {
  const { sessionId, candidate } = req.body || {};
  const s = webrtcSessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'unknown session' });
  try {
    s.ha.fireAndForget({ type: 'camera/webrtc/candidate', entity_id: s.entityId, session_id: s.haSessionId, candidate });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tear the session down (closes the HA subscription -> stops the stream).
app.post('/api/camera/:entityId/webrtc/stop', (req, res) => {
  closeWebrtcSession(req.body?.sessionId);
  res.json({ ok: true });
});

// ---- Serve the built dashboard (local hosting, one port) ----
// When a production build exists (dist/), this same process serves the app too,
// so wall tablets can point at http://<this-pc-ip>:<PORT> with nothing else running.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const hasBuild = fs.existsSync(distDir);
if (hasBuild) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`HA dashboard${hasBuild ? ' + API (serving built app)' : ' API only'} on http://localhost:${PORT}`);
  console.log(`  -> forwarding to ${HA_BASE_URL || '(HA_BASE_URL not set)'}`);
});
