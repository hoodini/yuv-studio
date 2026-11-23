import { FONTS } from '../shared/presets';
import { chat, listModels, publicAgentSettings, resetChat, saveAgentSettings, textModel } from './agent';
import { CAPTION_LANGS, checkLang, translateLines } from './translate';
import { searchStock, stockStatus } from './stock';
import type { StockKind, StockSource } from './stock';
import { addUploadedFont, FONT_DIR, fontsCss, importGoogleFont, listFonts, removeFont } from './fonts';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { OPS, addMediaClip, addOverlayClip, applyLayout, buildCaptions, copyCaptionTrack, findSilences, setCaptionTexts, listCaptions, newProject, removeSilences, summarize, timelineWords, toSrt } from '../shared/ops';
import type { OpName, Peaks } from '../shared/ops';
import { CAPTION_PRESETS, FX_PRESETS, SFX, TITLE_PRESETS, TRANSITIONS } from '../shared/presets';
import type { Asset, Project, Word } from '../shared/types';
import { uid } from '../shared/types';
import { listTemplates, projectFromTemplate, removeTemplate, saveTemplate } from './templates';
import { addBrandBumper, applyBrand, createBrand, getBrand, listBrands, listStarters, logoPath, projectFromStarter, removeBrand, removeBrandLogo, resolveBrandId, setBrandLogo, updateBrand } from './brands';
import { exportProject } from './export';
import { mountUploads } from './uploads';
import { downloadMedia } from './fetchUrl';
import { assetCache, buildThumbs, getPeaks, importAsset, mediaExt, thumbTime, run, FFMPEG } from './media';
import { createMcp } from './mcp';
import { ensureSfx, sfxPath } from './sfx';
import { DATA, DIRS, ROOT, bus, deleteProject, jobs, listProjects, loadProject, mutate, saveProject, startJob } from './store';
import { loadSettings, publicSettings, saveSettings } from './settings';
import { checkPython, transcribe, transcriptionStatus } from './transcribe';
import type { Lang } from './transcribe';
import { cloneVoice, listVoices, speak, voicePreview } from './voice';
import { autoReframe, enhanceVoice, findShorts, makeShort, removeBackground } from './smart';
import { cutRanges, findFillers, wordCutRanges } from '../shared/smart';

const PORT = Number(process.env.PORT || 5177);
const HOST = process.env.HOST || '127.0.0.1';
const BASE = `http://127.0.0.1:${PORT}`;
const DEV = process.argv.includes('--dev');

const app = express();

// The API can read any local file it is pointed at, so it only answers this machine's own pages.
// Checking Host blocks DNS rebinding; checking Origin blocks requests sent by other websites.
const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
/** Public host names the studio is reachable at through a tunnel, e.g. STUDIO_ALLOWED_HOSTS=studio.example.com */
const REMOTE_HOSTS = new Set((process.env.STUDIO_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
const TOKEN = process.env.STUDIO_TOKEN || '';
// A guessable token would be the only thing between the internet and this computer's files.
if (REMOTE_HOSTS.size && (TOKEN.length < 32 || new Set(TOKEN).size < 12)) {
  console.error('STUDIO_ALLOWED_HOSTS opens the studio to the internet. Set STUDIO_TOKEN to a random secret of at least 32 characters first:\n  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"');
  process.exit(1);
}
// Security headers on every answer. The editor may never be shown inside another site's frame (clickjacking:
// a hidden frame tricking clicks into delete / approve / sign out). Files people uploaded are served with a
// sandbox policy, so a file that is secretly a web page can never run script on the studio's address.
app.use((req, res, next) => {
  res.set({
    'x-frame-options': 'DENY',
    'content-security-policy': "frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), geolocation=(), payment=(), usb=()',
  });
  // Case-insensitive like Express routing itself, so /API/Projects/... cannot skip the sandbox.
  if (/^\/(api\/projects\/[^/]+\/assets\/|exports\/|sfx\/|fonts\/)/i.test(req.path)) res.set('content-security-policy', "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  next();
});
app.use((req, res, next) => {
  const host = String(req.headers.host || '').toLowerCase();
  const origin = req.headers.origin ? String(req.headers.origin).toLowerCase() : '';
  const known = (h: string) => LOCAL_HOSTS.has(h) || REMOTE_HOSTS.has(h);
  const originOk = !origin || known(origin.replace(/^https?:\/\//, ''));
  if (!known(host) || !originOk) return void res.status(403).json({ error: 'Forbidden: this host or origin is not allowed to use YUV.AI Studio' });
  // "Local" must be proven three ways, because Host alone can be forged by whatever sits in front:
  // the socket is loopback, nothing forwarded the request (tunnels and proxies add these headers), and Host is local.
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');
  const forwarded = ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'cf-ray'].some((h) => req.headers[h] != null);
  (req as any).remote = !LOCAL_HOSTS.has(host) || !loopback || forwarded;
  next();
});

// Remote visitors must prove they hold the access token.
//   Browser: the token is typed once into the login form, which hands back a random session id as a cookie.
//   API / MCP: the token is sent as a Bearer header on every request.
// Wrong tokens are counted for the whole server (a client can fake its address, not this counter). After 10 in
// 10 minutes no token is even compared until the window ends, so guessing stops. Sessions are 256-bit random ids
// that guessing cannot produce, so a signed-in browser keeps working during that pause.
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const WINDOW = 10 * 60000;
const MAX_FAILURES = 10;
// Counted per address (Cloudflare's cf-connecting-ip, which a visitor cannot set through the tunnel), so one
// stranger guessing cannot lock the owner out; and for the whole server, with a higher ceiling, so many addresses
// together still cannot keep guessing.
const MAX_GLOBAL = 100;
const guards = new Map<string, { count: number; since: number }>();
const addr = (req: express.Request) => String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?').slice(0, 64);
const bucket = (k: string) => {
  let g = guards.get(k);
  if (!g || Date.now() - g.since > WINDOW) guards.set(k, (g = { count: 0, since: Date.now() }));
  return g;
};
const lockedOut = (req: express.Request) => bucket(addr(req)).count >= MAX_FAILURES || bucket('*').count >= MAX_GLOBAL;
const failed = (req: express.Request) => {
  const a = bucket(addr(req));
  const g = bucket('*');
  if (a.count < MAX_FAILURES) a.count++;
  if (g.count < MAX_GLOBAL) g.count++;
  if (guards.size > 5000) for (const [k, v] of guards) if (Date.now() - v.since > WINDOW) guards.delete(k);
};

const SESSION_AGE = 30 * 24 * 3600 * 1000;
const SESSION_FILE = path.join(DATA, 'sessions.json');
const hash = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
/** sha256(session id) -> expiry. Only hashes are stored, so the file is useless to someone who reads it. */
let sessions: Record<string, number> = {};
/** Sessions belong to the token that opened them: change STUDIO_TOKEN and every old session is gone. */
const TOKEN_MARK = hash(`yuv-studio-session:${TOKEN}`);
const saveSessions = () => fs.writeFileSync(SESSION_FILE, JSON.stringify({ token: TOKEN_MARK, sessions }));
try {
  const saved = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  if (TOKEN && saved.token === TOKEN_MARK) sessions = saved.sessions || {};
  else saveSessions();
} catch {}
function newSession() {
  const id = crypto.randomBytes(32).toString('base64url');
  const live = Object.entries(sessions).filter(([, exp]) => exp > Date.now()).sort((x, y) => y[1] - x[1]).slice(0, 19);
  sessions = Object.fromEntries([...live, [hash(id), Date.now() + SESSION_AGE]]);
  saveSessions();
  return id;
}
const validSession = (id: string) => !!id && (sessions[hash(id)] || 0) > Date.now();

// Cloudflare Access in front of the public address. Access signs in the visitor (e.g. a one-time code to an allowed
// email) and adds a signed JWT to every request it lets through. A valid one stands in for the token, so there is
// one login, not two. Set STUDIO_ACCESS_TEAM (e.g. myteam.cloudflareaccess.com) and STUDIO_ACCESS_AUD (the
// application's Audience tag); STUDIO_ACCESS_EMAILS optionally narrows who counts, on top of the Access policy.
const ACCESS_TEAM = (process.env.STUDIO_ACCESS_TEAM || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
const ACCESS_AUD = process.env.STUDIO_ACCESS_AUD || '';
const ACCESS_EMAILS = (process.env.STUDIO_ACCESS_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
let accessCerts: { keys: any[]; at: number } = { keys: [], at: 0 };
async function accessKeys(refresh = false) {
  if (refresh || !accessCerts.keys.length || Date.now() - accessCerts.at > 3600e3) {
    const res = await fetch(`https://${ACCESS_TEAM}/cdn-cgi/access/certs`);
    if (res.ok) accessCerts = { keys: ((await res.json()) as any).keys || [], at: Date.now() };
  }
  return accessCerts.keys;
}
/** The signed-in Access user of this request (their email), or null. Only a signature from the team's keys counts. */
async function accessUser(req: express.Request): Promise<string | null> {
  if (!ACCESS_TEAM || !ACCESS_AUD) return null;
  const jwt = String(req.headers['cf-access-jwt-assertion'] || '');
  const [h, p, s] = jwt.split('.');
  if (!h || !p || !s) return null;
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (header.alg !== 'RS256') return null;
    let jwk = (await accessKeys()).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await accessKeys(true)).find((k) => k.kid === header.kid); // keys rotate
    if (!jwk) return null;
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
    const now = Date.now() / 1000;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!ok || claims.iss !== `https://${ACCESS_TEAM}` || !aud.includes(ACCESS_AUD) || !(claims.exp > now) || (claims.nbf && claims.nbf > now + 60)) return null;
    const email = String(claims.email || '').toLowerCase();
    if (ACCESS_EMAILS.length && !ACCESS_EMAILS.includes(email)) return null;
    return email || String(claims.common_name || claims.sub || 'service');
  } catch {
    return null;
  }
}

const loginPage = (msg = '') =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#08080C"><title>YUV.AI Studio</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;font-family:Inter,system-ui,sans-serif;color:#fff;background:radial-gradient(900px 520px at 85% 0%,rgba(23,188,207,.22),transparent 65%),radial-gradient(900px 600px at 10% 100%,rgba(70,69,170,.4),transparent 65%),#08080C"><form method="post" action="/login" style="background:#14141B;padding:36px 40px;border-radius:16px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);display:grid;gap:18px;width:min(400px,88vw)"><a href="/" style="display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit"><img src="/brand/mark-128.png" alt="" width="34" height="34"><strong style="font-size:15px;letter-spacing:.22em">YUV.AI</strong><span style="font-size:12px;font-weight:700;letter-spacing:.26em;color:#5DE1EE">STUDIO</span></a><label style="display:grid;gap:8px;font-size:14px;color:#B9B9C9">Access token<input name="token" type="password" autocomplete="current-password" autofocus required style="font:inherit;font-size:16px;color:#fff;padding:13px 18px;border-radius:999px;border:0;background:#1D1D26;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);outline-color:#17BCCF"></label>${msg ? `<span style="color:#E08BE4;font-weight:600">${msg}</span>` : ''}<button style="font:inherit;font-weight:600;font-size:17px;min-height:54px;border:0;border-radius:999px;background:#fff;color:#08080C;cursor:pointer">Open the studio</button></form></body></html>`;
/** The home page, the brand images, and the app manifest and service worker (no data in either) are the only things a visitor without the token may read. */
/** The marketing home page is optional (it is not part of the open-source edition). */
const HAS_HOME = fs.existsSync(path.join(ROOT, DEV ? 'public' : 'dist', 'home', 'index.html'));
const isPublic = (p: string) => /^\/(home|brand)(\/[\w-]+(\.[\w-]+)*)*\/?$/.test(p) || p === '/manifest.webmanifest' || p === '/sw.js';
const sessionCookie = (req: express.Request) => /(?:^|;\s*)studio_session=([^;]+)/.exec(String(req.headers.cookie || ''))?.[1] || '';
app.get('/login', (req, res) => ((req as any).remote && !validSession(sessionCookie(req)) ? res.send(loginPage()) : res.redirect('/')));
app.post('/login', express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
  if (!TOKEN) return void res.status(403).send(loginPage('Remote access is not set up.'));
  if (lockedOut(req)) return void res.status(429).send(loginPage('Too many wrong attempts. Try again in a few minutes.'));
  if (!same(String(req.body?.token || ''), TOKEN)) {
    failed(req);
    return void res.status(401).send(loginPage('That token is not correct.'));
  }
  res.setHeader('set-cookie', `studio_session=${newSession()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_AGE / 1000}${(req as any).remote ? '; Secure' : ''}`);
  res.redirect('/');
});
/** Sign this browser out, or with ?all=1 every browser (e.g. after losing a phone). */
app.post('/logout', (req, res) => {
  const id = sessionCookie(req);
  const all = req.query.all != null && (validSession(id) || !(req as any).remote);
  if (all) sessions = {};
  else if (id) delete sessions[hash(id)];
  saveSessions();
  res.setHeader('set-cookie', 'studio_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true, signedOut: all ? 'all' : 'this browser' });
});
app.use(async (req, res, next) => {
  if (!(req as any).remote) return next();
  if (req.method === 'GET' && isPublic(req.path)) return next();
  if (await accessUser(req)) return next();
  // Forwarded requests are never trusted without a token, even when no public host is configured.
  if (!TOKEN) return void res.status(403).json({ error: 'Forbidden: remote access is not set up (STUDIO_TOKEN)' });
  if (validSession(sessionCookie(req))) return next();
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (bearer) {
    if (lockedOut(req)) return void res.status(429).json({ error: 'Too many wrong tokens. Try again in a few minutes.' });
    if (same(bearer, TOKEN)) return next();
    failed(req);
    return void res.status(401).json({ error: 'Unauthorized: wrong access token' });
  }
  if (req.path.startsWith('/api') || req.path === '/mcp' || req.method !== 'GET') return void res.status(401).json({ error: 'Unauthorized: send the studio access token as "Authorization: Bearer <token>"' });
  // A visitor who opens the address itself meets the home page; any other page asks for the token.
  if (req.path === '/' && HAS_HOME) return void res.redirect('/home/');
  res.status(401).send(loginPage());
});
app.use(express.json({ limit: '50mb' }));

const origin = (req: express.Request) => String(req.headers['x-client-id'] || 'api');
const wrap = (fn: (req: express.Request, res: express.Response) => any) => async (req: express.Request, res: express.Response) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e: any) {
    if (!res.headersSent) res.status(e.status || 400).json({ error: String(e.message || e) });
  }
};
const pid = (req: express.Request) => String(req.params.id);
const fail = (message: string): never => {
  throw Object.assign(new Error(message), { status: 400 });
};
const asset = (p: Project, id: string): Asset => {
  const a = p.assets.find((x) => x.id === id);
  if (!a) throw Object.assign(new Error(`Asset not found: ${id}`), { status: 404 });
  return a;
};
const lang = (v: any): Lang => (v === 'he' || v === 'en' ? v : 'auto');

// ---------- projects ----------

app.get('/api/health', (_req, res) => void res.json({ ok: true, name: 'yuv-studio' }));
app.get('/api/presets', (_req, res) => void res.json({ captions: CAPTION_PRESETS, titles: TITLE_PRESETS, transitions: TRANSITIONS, fx: FX_PRESETS, sfx: SFX }));
app.get('/api/projects', wrap(() => listProjects()));
app.post(
  '/api/projects',
  wrap(async (req) => {
    const b = req.body || {};
    const brandId = resolveBrandId(b.brandId);
    if (b.starterId) return projectFromStarter(String(b.starterId), { name: b.name ? String(b.name) : undefined, brandId, lang: b.lang }, origin(req));
    let p: Project;
    if (b.templateId) p = await projectFromTemplate(String(b.templateId), String(b.name || ''), origin(req));
    else {
      p = newProject(b.name || 'Untitled', b.width || 1920, b.height || 1080, b.fps || 60);
      // A size chosen in the new-project dialog stays, whatever video is dropped in first.
      if (b.width && b.height) p.sizeLocked = true;
      if (b.layout) applyLayout(p, String(b.layout));
      p = saveProject(p, origin(req));
    }
    if (brandId) await applyBrand(p.id, brandId, origin(req));
    return loadProject(p.id);
  }),
);
app.get('/api/starters', wrap(() => listStarters()));

// ---------- brand kits ----------
app.get('/api/brands', wrap(() => listBrands()));
// A brand font that is not installed yet is fetched from Google Fonts, like a font an agent names in a title.
app.post('/api/brands', wrap(async (req) => (await ensureFonts([req.body?.fonts?.heading, req.body?.fonts?.body]), createBrand(req.body || {}))));
app.put('/api/brands/:bid', wrap(async (req) => (await ensureFonts([req.body?.fonts?.heading, req.body?.fonts?.body]), updateBrand(String(req.params.bid), req.body || {}))));
app.delete('/api/brands/:bid', wrap((req) => removeBrand(String(req.params.bid))));
app.put('/api/brands/:bid/logo', express.raw({ type: () => true, limit: '15mb' }), wrap((req) => setBrandLogo(String(req.params.bid), req.body as Buffer, String(req.headers['content-type'] || ''))));
app.delete('/api/brands/:bid/logo', wrap((req) => removeBrandLogo(String(req.params.bid))));
app.get('/api/brands/:bid/logo', (req, res) => {
  try {
    const k = getBrand(String(req.params.bid));
    if (!k.logo) return void res.status(404).end();
    res.set('cache-control', 'private, max-age=86400').sendFile(logoPath(k));
  } catch {
    res.status(404).end();
  }
});
app.post('/api/projects/:id/brand', wrap((req) => (req.body?.remove ? (mutate(pid(req), (d) => void OPS.set_brand_style(d, { remove: true }), origin(req)), { brand: null }) : applyBrand(pid(req), resolveBrandId(req.body?.brandId || 'default') || fail('No brand kit yet. Create one first.'), origin(req), { logo: req.body?.logo }))));
app.post('/api/projects/:id/bumper', wrap((req) => addBrandBumper(pid(req), { kind: req.body?.kind === 'outro' ? 'outro' : 'intro', duration: req.body?.duration, text: req.body?.text }, origin(req))));
app.get('/api/templates', wrap(() => listTemplates()));
app.post('/api/templates', wrap((req) => saveTemplate(String(req.body?.projectId || ''), String(req.body?.name || ''))));
app.delete('/api/templates/:id', wrap((req) => removeTemplate(String(req.params.id))));
app.get('/api/projects/:id', wrap((req) => loadProject(pid(req))));
app.get('/api/projects/:id/summary', wrap((req) => summarize(loadProject(pid(req)))));
app.put(
  '/api/projects/:id',
  wrap((req) => {
    const current = loadProject(pid(req));
    // Assets are owned by the server (imports, proxies); the editor only sends the timeline.
    const next: Project = { ...req.body, id: current.id, assets: current.assets, rev: current.rev, createdAt: current.createdAt };
    saveProject(next, origin(req));
    return { rev: next.rev };
  }),
);
app.delete(
  '/api/projects/:id',
  wrap((req) => {
    deleteProject(pid(req));
    // Its agent-turn snapshots go with it.
    const safe = pid(req).replace(/[^\w-]/g, '');
    if (safe) fs.rmSync(path.join(DATA, 'snapshots', safe), { recursive: true, force: true });
  }),
);

/** Run one edit operation, or several in order: { op, args } or { ops: [{ op, args }, ...] }. */
app.post(
  '/api/projects/:id/ops',
  wrap(async (req) => {
    const list: { op: OpName; args?: any }[] = req.body.ops || [req.body];
    await ensureFonts(list.map((o) => o.args?.style?.fontFamily || o.args?.patch?.style?.fontFamily));
    const results = mutate(
      pid(req),
      (p) =>
        list.map((o) => {
          const fn = OPS[o.op];
          if (!fn) throw new Error(`Unknown op "${o.op}". Available: ${Object.keys(OPS).join(', ')}`);
          const args = o.args || {};
          const df = loadSettings().defaultFont;
          // the default font is for projects without a brand; a brand's own fonts win
          if (o.op === 'add_text' && df && !p.brand && !args.style?.fontFamily) args.style = { ...(args.style || {}), fontFamily: df };
          return fn(p, args);
        }),
      origin(req),
    );
    return req.body.ops ? { results } : { result: results[0] };
  }),
);

// ---------- media ----------

const upload = multer({
  storage: multer.diskStorage({
    destination: DIRS.media,
    filename: (_req, file, cb) => cb(null, `${uid('m_')}${mediaExt(file.originalname)}`),
  }),
});
app.post(
  '/api/projects/:id/assets',
  upload.array('files'),
  wrap(async (req) => {
    loadProject(pid(req));
    const out: Asset[] = [];
    for (const f of (req.files as Express.Multer.File[]) || []) {
      const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
      out.push(await importAsset(pid(req), f.path, name));
    }
    return out;
  }),
);
// A share from the phone's share sheet that the service worker did not catch (first visit): open the mobile mode.
app.post('/share', (_req, res) => res.redirect(303, '/?m=1'));
// Chunked, resumable uploads (phones, and anything over Cloudflare's 100 MB request limit).
mountUploads(app, wrap, importAsset, origin);
app.post(
  '/api/projects/:id/assets/import',
  wrap(async (req) => {
    loadProject(pid(req));
    const file = String(req.body.path || '');
    // Network paths (\\server\share, //server/share) would make Windows connect out and hand over the user's login hash.
    if (/^[\\/]{2}/.test(file)) throw new Error('Network paths are not accepted. Copy the file to this computer first.');
    // From the internet (phone, remote MCP) a file path would reach any file on this computer: upload instead.
    if ((req as any).remote) throw new Error('Importing by file path works only on the computer itself. Upload the file instead.');
    return importAsset(pid(req), file, req.body.name);
  }),
);
/** Download a media file from a public link (e.g. a clip from an AI video tool) and add it to the project. */
app.post(
  '/api/projects/:id/assets/import-url',
  wrap((req) => {
    const p = loadProject(pid(req));
    const b = req.body || {};
    const from = origin(req);
    return startJob('import', p.id, async (update) => {
      update(0, 'Downloading');
      const { file, name } = await downloadMedia(String(b.url || ''), update);
      let a: Asset;
      try {
        a = await importAsset(p.id, file, b.name || name, from);
      } catch (e) {
        fs.rmSync(file, { force: true });
        throw e;
      }
      // Stock media keeps where it came from and the credit its licence asks for.
      if (b.source && typeof b.source === 'object') {
        const s = b.source;
        const link = String(s.url || '');
        const src = { name: String(s.name || '').slice(0, 60), url: /^https?:\/\//i.test(link) ? link.slice(0, 500) : '', license: String(s.license || '').slice(0, 80), credit: String(s.credit || '').slice(0, 400) };
        mutate(p.id, (draft) => {
          const x = draft.assets.find((y) => y.id === a.id);
          if (x) x.source = src;
        }, from);
        a = { ...a, source: src };
      }
      const clip = b.overlay
        ? mutate(p.id, (draft) => addOverlayClip(draft, a.id, { start: b.start }), from)
        : b.addToTimeline || b.broll
          ? mutate(p.id, (draft) => addMediaClip(draft, a.id, { start: b.start, broll: !!b.broll }), from)
          : undefined;
      return { asset: a, clip };
    });
  }),
);
// ---------- free stock media (B-roll, overlays, photos, music) ----------
app.get('/api/stock/status', wrap(() => stockStatus()));
app.get('/api/stock/search', wrap((req) => searchStock(String(req.query.source || 'openverse') as StockSource, String(req.query.kind || 'image') as StockKind, String(req.query.q || ''), Number(req.query.page) || 1)));
app.put('/api/stock/keys', wrap((req) => (saveSettings({ stock: { ...(typeof req.body?.pexelsKey === 'string' ? { pexelsKey: req.body.pexelsKey } : {}), ...(typeof req.body?.pixabayKey === 'string' ? { pixabayKey: req.body.pixabayKey } : {}) } }), stockStatus())));

app.get('/api/projects/:id/assets/:aid/file', (req, res) => {
  try {
    const a = asset(loadProject(pid(req)), String(req.params.aid));
    res.sendFile(req.query.orig || !a.proxy || !fs.existsSync(a.proxy) ? a.path : a.proxy, { acceptRanges: true, dotfiles: 'allow' });
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});
app.get('/api/projects/:id/assets/:aid/thumb/:i', async (req, res) => {
  try {
    const a = asset(loadProject(pid(req)), String(req.params.aid));
    if (a.kind === 'image') return void res.sendFile(a.path, { dotfiles: 'allow' });
    const i = Math.max(0, Math.min(a.thumbs - 1, Number(req.params.i) || 0));
    const file = path.join(assetCache(a.id), `thumb_${i}.jpg`);
    if (!fs.existsSync(file)) await run(FFMPEG, ['-v', 'error', '-ss', thumbTime(a, i).toFixed(3), '-i', a.path, '-frames:v', '1', '-vf', 'scale=-2:96', '-q:v', '6', '-y', file]);
    void buildThumbs(a);
    res.set('cache-control', 'public, max-age=86400').sendFile(file, { dotfiles: 'allow' });
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});
app.get('/api/projects/:id/assets/:aid/peaks', wrap((req) => getPeaks(asset(loadProject(pid(req)), String(req.params.aid)))));

// ---------- transcription and captions ----------

/** Transcribe every source that is audible on the timeline. */
async function transcripts(p: Project, language: Lang, update: (f: number, m?: string) => void, opts: { force?: boolean; engine?: string; verbatim?: boolean } = {}) {
  const ids = new Set<string>();
  for (const t of p.tracks) if (!t.muted && (t.kind === 'video' || t.kind === 'audio')) for (const c of t.clips) if (c.assetId && !c.muted) ids.add(c.assetId);
  const used = p.assets.filter((a) => ids.has(a.id) && a.hasAudio && !a.path.startsWith(DIRS.sfx));
  const out: Record<string, Word[]> = {};
  for (let i = 0; i < used.length; i++) out[used[i].id] = (await transcribe(used[i], language, (f, m) => update((i + f) / used.length, m), opts)).words;
  return out;
}

app.post(
  '/api/projects/:id/transcribe',
  wrap((req) => {
    const p = loadProject(pid(req));
    const a = asset(p, String(req.body.assetId));
    return startJob('transcribe', p.id, (update) => transcribe(a, lang(req.body.language), update, { force: !!req.body.force, engine: req.body.engine }));
  }),
);
app.post(
  '/api/projects/:id/timeline-transcript',
  wrap((req) => {
    const p = loadProject(pid(req));
    return startJob('transcribe', p.id, async (update) => {
      const words = timelineWords(loadProject(p.id), await transcripts(p, lang(req.body.language), update, { force: !!req.body.force, engine: req.body.engine }));
      // Lines of about one sentence each, with timeline times.
      const lines: { start: number; end: number; text: string }[] = [];
      let cur: Word[] = [];
      const flush = () => {
        if (cur.length) lines.push({ start: Math.round(cur[0].t0 * 100) / 100, end: Math.round(cur[cur.length - 1].t1 * 100) / 100, text: cur.map((w) => w.text).join(' ') });
        cur = [];
      };
      for (const w of words) {
        if (cur.length && (w.t0 - cur[cur.length - 1].t1 > 0.8 || cur.length >= 18)) flush();
        cur.push(w);
        if (/[.?!]$/.test(w.text)) flush();
      }
      flush();
      return { language: lang(req.body.language), lines };
    });
  }),
);
app.post(
  '/api/projects/:id/captions',
  wrap((req) => {
    const p = loadProject(pid(req));
    const b = req.body || {};
    const from = lang(b.language);
    // Captions in another language than the speech: transcribe, then translate the text, keeping the times.
    const to = b.translateTo && b.translateTo !== from ? checkLang(String(b.translateTo)) : '';
    if (to) {
      const ready = textModel();
      if (!ready.ok) throw Object.assign(new Error(ready.error), { status: 400 });
    }
    return startJob('captions', p.id, async (update) => {
      const tr = await transcripts(p, from, to ? (f, m) => update(f * 0.7, m) : update, { force: !!b.force, engine: b.engine });
      let track = mutate(p.id, (draft) => buildCaptions(draft, tr, { maxWords: b.maxWords, maxChars: b.maxChars, gap: b.gap, preset: b.preset }));
      if (to) {
        const texts = await translateLines(track.clips.map((c) => c.text || ''), to, from === 'auto' ? undefined : from, (f, m) => update(0.7 + f * 0.3, m));
        track = mutate(p.id, (draft) => setCaptionTexts(draft, track.id, texts, to));
      }
      return { trackId: track.id, captions: track.clips.length, language: to || from, preview: track.clips.slice(0, 5).map((c) => c.text) };
    });
  }),
);
app.post(
  '/api/projects/:id/captions/translate',
  wrap((req) => {
    const p = loadProject(pid(req));
    const b = req.body || {};
    const to = checkLang(String(b.to || ''));
    const src = b.trackId ? p.tracks.find((t) => t.id === b.trackId && t.kind === 'caption') : p.tracks.find((t) => t.kind === 'caption' && t.clips.length);
    if (!src?.clips.length) throw Object.assign(new Error('There are no captions to translate. Generate captions first.'), { status: 400 });
    const ready = textModel();
    if (!ready.ok) throw Object.assign(new Error(ready.error), { status: 400 });
    const from = typeof b.from === 'string' && CAPTION_LANGS[b.from] ? b.from : src.lang;
    const needCaptionTrack = (d: Project, id: string) => {
      const t = d.tracks.find((x) => x.id === id && x.kind === 'caption');
      if (!t) throw new Error('The caption track is gone. Translate again.');
      return t;
    };
    return startJob('captions', p.id, async (update) => {
      const texts = await translateLines(
        src.clips.map((c) => c.text || ''),
        to,
        from,
        update,
      );
      const track = mutate(p.id, (draft) => {
        // keepOriginal: the translation goes on its own caption layer above the original, for two-language captions.
        const target = b.keepOriginal ? copyCaptionTrack(draft, src.id, `${src.name} (${CAPTION_LANGS[to].name})`) : needCaptionTrack(draft, src.id);
        if (target.clips.length !== texts.length) throw new Error('The captions changed while they were being translated. Translate again.');
        return setCaptionTexts(draft, target.id, texts, to);
      });
      return { trackId: track.id, captions: track.clips.length, language: to, keptOriginal: !!b.keepOriginal, preview: track.clips.slice(0, 5).map((c) => c.text) };
    });
  }),
);
app.get('/api/caption-languages', (_req, res) => void res.json(Object.entries(CAPTION_LANGS).map(([id, l]) => ({ id, ...l }))));

app.get('/api/projects/:id/captions', wrap((req) => listCaptions(loadProject(pid(req)))));
app.get('/api/projects/:id/captions.srt', (req, res) => {
  try {
    const p = loadProject(pid(req));
    res.set({ 'content-type': 'application/x-subrip; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(p.name)}.srt` }).send(toSrt(p));
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});

// Settings: the transcription engine and the cloud provider's key. The key is write-only for the browser.
/** Families the editor ships with; anything else named in a style is looked up on Google Fonts once. */
const BUNDLED = new Set(FONTS.map((f) => f.family.toLowerCase()));
async function ensureFonts(names: (string | undefined)[]) {
  const have = new Set(listFonts().map((f) => f.family.toLowerCase()));
  for (const n of new Set(names.filter((x): x is string => !!x && typeof x === 'string'))) {
    if (BUNDLED.has(n.toLowerCase()) || have.has(n.toLowerCase())) continue;
    await importGoogleFont(n).catch(() => {});
  }
}

// ---------- the in-editor AI agent ----------
const SNAP_DIR = path.join(DATA, 'snapshots');
/** A copy of the project as it was before an agent turn. The last 30 per project are kept. */
function takeSnapshot(projectId: string, p: object) {
  const dir = path.join(SNAP_DIR, projectId.replace(/[^\w-]/g, ''));
  fs.mkdirSync(dir, { recursive: true });
  const id = `s_${Date.now()}`;
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(p));
  const all = fs.readdirSync(dir).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 30))) fs.rmSync(path.join(dir, old), { force: true });
  return id;
}
function snapshotFile(projectId: string, id: string) {
  if (!/^s_\d+$/.test(id)) throw Object.assign(new Error('Unknown snapshot'), { status: 400 });
  const f = path.join(SNAP_DIR, projectId.replace(/[^\w-]/g, ''), `${id}.json`);
  if (!fs.existsSync(f)) throw Object.assign(new Error('That snapshot is gone'), { status: 404 });
  return f;
}

app.get('/api/agent/settings', wrap(() => publicAgentSettings()));
app.put('/api/agent/settings', wrap((req) => saveAgentSettings(req.body || {})));
app.get('/api/agent/models', wrap(() => listModels()));
app.delete('/api/projects/:id/chat', wrap((req) => (resetChat(pid(req)), { ok: true })));
// One user turn, streamed as JSON lines: {type:'text'|'tool'|'result'|'error'|'done', ...}. Closing the request stops it.
app.post('/api/projects/:id/chat', async (req, res) => {
  const id = pid(req);
  try {
    loadProject(id);
  } catch (e: any) {
    return void res.status(e.status || 404).json({ error: String(e.message) });
  }
  const text = String(req.body?.text || '').trim();
  if (!text) return void res.status(400).json({ error: 'Write a message' });
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  const before = loadProject(id);
  const snapshot = takeSnapshot(id, before);
  const stop = new AbortController();
  res.on('close', () => stop.abort());
  const emit = (e: Record<string, any>) => !res.writableEnded && res.write(JSON.stringify(e) + '\n');
  // First, so the editor can review the turn's changes even when the user stops it halfway.
  emit({ type: 'start', snapshot });
  try {
    const ctx = { playhead: Number(req.body?.playhead) || 0, selection: Array.isArray(req.body?.selection) ? req.body.selection.slice(0, 20).map(String) : [], approve: req.body?.approve === true, declined: req.body?.declined === true };
    await chat(id, text, ctx, emit, stop.signal, BASE, TOKEN);
  } catch (e: any) {
    emit({ type: 'error', error: String(e?.message || e) });
  }
  // Tell the editor whether the turn changed anything, and how to take it back.
  emit({ type: 'done', snapshot: loadProject(id).rev !== before.rev ? snapshot : undefined });
  res.end();
});
/** The project as it was before an agent turn: the baseline the editor reviews the agent's changes against. */
app.get(
  '/api/projects/:id/snapshots/:snap',
  wrap((req) => JSON.parse(fs.readFileSync(snapshotFile(pid(req), String(req.params.snap)), 'utf8'))),
);
app.post(
  '/api/projects/:id/restore',
  wrap((req) => {
    const file = snapshotFile(pid(req), String(req.body?.snapshot || ''));
    const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
    mutate(pid(req), (p) => {
      for (const k of ['name', 'width', 'height', 'fps', 'tracks', 'assets', 'markIn', 'markOut'] as const) (p as any)[k] = snap[k];
    }, origin(req));
    return { ok: true };
  }),
);

// ---------- fonts ----------
const fontUpload = multer({ dest: DIRS.tmp, limits: { fileSize: 30 * 1024 * 1024 } });
app.get('/api/fonts', wrap(() => listFonts()));
app.get('/api/fonts.css', (_req, res) => void res.type('text/css').set('cache-control', 'no-cache').send(fontsCss()));
app.post(
  '/api/fonts',
  fontUpload.single('file'),
  wrap(async (req) => {
    const f = (req as any).file as Express.Multer.File | undefined;
    if (!f) throw Object.assign(new Error('Send a font file in the "file" field'), { status: 400 });
    return addUploadedFont(f.path, Buffer.from(f.originalname, 'latin1').toString('utf8'), { family: req.body?.family, weight: Number(req.body?.weight) || undefined, style: req.body?.style });
  }),
);
app.post('/api/fonts/google', wrap((req) => importGoogleFont(String(req.body?.family || ''))));
app.delete('/api/fonts/:family', wrap((req) => removeFont(String(req.params.family))));
app.use('/fonts', express.static(FONT_DIR, { fallthrough: false, dotfiles: 'deny' }));

app.get('/api/settings', wrap(() => ({ ...publicSettings(), status: transcriptionStatus() })));
app.put('/api/settings', wrap((req) => (saveSettings(req.body || {}), { ...publicSettings(), status: transcriptionStatus() })));

app.post(
  '/api/projects/:id/remove-silences',
  wrap(async (req) => {
    const p = loadProject(pid(req));
    const peaks: Record<string, Peaks> = {};
    for (const a of p.assets) if (a.hasAudio && !a.path.startsWith(DIRS.sfx)) peaks[a.id] = await getPeaks(a);
    if (req.body.dryRun) return { ranges: findSilences(p, peaks, req.body) };
    return mutate(p.id, (draft) => removeSilences(draft, peaks, req.body), origin(req));
  }),
);

// ---------- smart tools: words, fillers, clean voice, reframe, shorts ----------

/** The spoken words on the timeline, with timeline times and the fillers marked: the transcript editor's data. */
app.post(
  '/api/projects/:id/words',
  wrap((req) => {
    const p = loadProject(pid(req));
    const b = req.body || {};
    return startJob('smart', p.id, async (update) => {
      const words = timelineWords(loadProject(p.id), await transcripts(p, lang(b.language), update, { engine: b.engine, verbatim: true }));
      const fillers = findFillers(words, { aggressive: !!b.aggressive });
      const mark = new Map<number, string>();
      for (const f of fillers) for (let k = 0; k < f.n; k++) mark.set(f.i + k, f.kind);
      const r = (n: number) => Math.round(n * 1000) / 1000;
      return { words: words.map((w, i) => ({ i, t0: r(w.t0), t1: r(w.t1), text: w.text, filler: mark.get(i) })), fillers: fillers.length };
    });
  }),
);
/** Cut the "um"s, the stutters and (aggressive) the soft fillers like "basically" / "כאילו". */
app.post(
  '/api/projects/:id/remove-fillers',
  wrap((req) => {
    const p = loadProject(pid(req));
    const b = req.body || {};
    return startJob('smart', p.id, async (update) => {
      const tr = await transcripts(p, lang(b.language), (f, m) => update(f * 0.9, m), { engine: b.engine, verbatim: true });
      const words = timelineWords(loadProject(p.id), tr);
      const fillers = findFillers(words, { aggressive: !!b.aggressive });
      const ranges = wordCutRanges(words, fillers);
      const list = fillers.map((f) => ({ text: f.text, kind: f.kind, start: Math.round(f.t0 * 100) / 100 }));
      if (b.dryRun) return { fillers: list, ranges };
      const done = mutate(p.id, (draft) => cutRanges(draft, ranges), origin(req));
      return { ...done, fillers: list };
    });
  }),
);
/** Cut words by their index in the words list (from /words): editing the video by deleting text. */
app.post(
  '/api/projects/:id/cut-words',
  wrap((req) => {
    const p = loadProject(pid(req));
    const b = req.body || {};
    return startJob('smart', p.id, async (update) => {
      const words = timelineWords(loadProject(p.id), await transcripts(p, lang(b.language), update, { engine: b.engine, verbatim: true }));
      const idx = (Array.isArray(b.indices) ? b.indices : []).map(Number).filter((i: number) => Number.isInteger(i) && i >= 0 && i < words.length);
      if (!idx.length) throw Object.assign(new Error('No words to cut. Pass indices from the words list.'), { status: 400 });
      const ranges = wordCutRanges(words, idx.map((i: number) => ({ i })));
      return mutate(p.id, (draft) => cutRanges(draft, ranges), origin(req));
    });
  }),
);
app.post(
  '/api/projects/:id/assets/:aid/enhance-voice',
  wrap((req) => {
    const p = loadProject(pid(req));
    const a = asset(p, String(req.params.aid));
    const strength = req.body?.strength === 'strong' ? 'strong' : 'light';
    return startJob('smart', p.id, (update) => enhanceVoice(p.id, a, strength, update));
  }),
);
app.post(
  '/api/projects/:id/clips/:cid/remove-background',
  wrap((req) => {
    const p = loadProject(pid(req));
    const b = req.body || {};
    const background = b.background === 'blur' || b.background === 'original' ? b.background : 'none';
    return startJob('smart', p.id, (update) => removeBackground(p.id, String(req.params.cid), { background, text: b.text ? String(b.text).slice(0, 120) : undefined, quality: b.quality === 'fast' ? 'fast' : 'quality' }, update));
  }),
);
app.post(
  '/api/projects/:id/reframe',
  wrap((req) => {
    const p = loadProject(pid(req));
    const w = Number(req.body?.width) || 1080;
    const h = Number(req.body?.height) || 1920;
    if (!(w >= 16 && h >= 16 && w <= 7680 && h <= 7680)) throw Object.assign(new Error('width and height must be 16-7680'), { status: 400 });
    return startJob('smart', p.id, (update) => autoReframe(p.id, w, h, update));
  }),
);
app.post(
  '/api/projects/:id/find-shorts',
  wrap((req) => {
    const p = loadProject(pid(req));
    const b = req.body || {};
    const ready = textModel();
    if (!ready.ok) throw Object.assign(new Error(ready.error), { status: 400 });
    return startJob('smart', p.id, async (update) => {
      const words = timelineWords(loadProject(p.id), await transcripts(p, lang(b.language), (f, m) => update(f * 0.5, m), { engine: b.engine }));
      return { clips: await findShorts(words, { count: b.count, minSec: b.minSec, maxSec: b.maxSec }, (f, m) => update(0.5 + f * 0.5, m)) };
    });
  }),
);
app.post(
  '/api/projects/:id/make-short',
  wrap((req) => {
    const p = loadProject(pid(req));
    const b = req.body || {};
    return startJob('smart', p.id, (update) => makeShort(p.id, { start: Number(b.start), end: Number(b.end), title: b.title ? String(b.title) : undefined, width: b.width, height: b.height, reframe: b.reframe }, update));
  }),
);

// ---------- voice: text to speech and voice cloning (Cartesia) ----------

app.get('/api/voice/voices', wrap((req) => listVoices({ q: String(req.query.q || ''), language: String(req.query.language || ''), mine: !!req.query.mine })));
app.get('/api/voice/voices/:vid/preview', async (req, res) => {
  try {
    const clip = await voicePreview(String(req.params.vid), String(req.query.language || ''));
    res.set({ 'content-type': clip.type, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=3600' }).send(clip.body);
  } catch (e: any) {
    res.status(e.status || 400).json({ error: String(e.message || e) });
  }
});
app.post('/api/projects/:id/speak', wrap((req) => speak(pid(req), req.body || {}, origin(req))));
app.post('/api/projects/:id/clone-voice', wrap((req) => cloneVoice(pid(req), req.body || {})));

// ---------- sound effects ----------

app.use('/sfx', express.static(DIRS.sfx));
app.post(
  '/api/projects/:id/sfx',
  wrap(async (req) => {
    const p = loadProject(pid(req));
    const id = String(req.body.sfx || '');
    const def = SFX.find((s) => s.id === id);
    if (!def) throw new Error(`Unknown sound "${id}". Available: ${SFX.map((s) => s.id).join(', ')}`);
    const file = sfxPath(id);
    const existing = p.assets.find((a) => a.path === file);
    const a = existing || (await importAsset(p.id, file, `SFX · ${def.label}`, origin(req)));
    return mutate(
      p.id,
      (draft) => {
        const clip = addMediaClip(draft, a.id, { start: Number(req.body.start) || 0 });
        if (req.body.volume != null) clip.volume = Number(req.body.volume);
        return clip;
      },
      origin(req),
    );
  }),
);

// ---------- export and jobs ----------

app.use('/exports', express.static(DIRS.exports));
let exportQueue: Promise<unknown> = Promise.resolve();
app.post(
  '/api/projects/:id/export',
  wrap((req) => {
    const p = loadProject(pid(req));
    const opts = req.body || {};
    return startJob('export', p.id, (update) => {
      // One render at a time: exporting to several platforms queues them instead of running them all at once.
      update(0, 'Waiting for the export before it');
      const mine = exportQueue.then(() => exportProject(loadProject(p.id), opts, BASE, update));
      exportQueue = mine.catch(() => {});
      return mine;
    });
  }),
);
app.get('/api/jobs', wrap(() => [...jobs.values()].slice(-50)));
app.get(
  '/api/jobs/:id',
  wrap(async (req) => {
    const job = jobs.get(String(req.params.id));
    if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });
    // ?wait=1 holds the request until the job finishes (or 25 s pass).
    if (req.query.wait && job.status === 'running') {
      await new Promise<void>((resolve) => {
        const done = (j: any) => j.id === job.id && j.status !== 'running' && finish();
        const timer = setTimeout(finish, 25000);
        function finish() {
          clearTimeout(timer);
          bus.off('job', done);
          resolve();
        }
        bus.on('job', done);
      });
    }
    return job;
  }),
);

/** Server-sent events: live project changes (from the API / MCP) and job progress. */
app.get('/api/events', (req, res) => {
  res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.flushHeaders();
  const send = (event: string, data: any) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const onProject = (id: string, from: string, rev: number) => send('project', { id, origin: from, rev });
  const onJob = (job: any) => send('job', job);
  const onActivity = (a: any) => send('activity', a);
  bus.on('project', onProject);
  bus.on('job', onJob);
  bus.on('activity', onActivity);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    bus.off('project', onProject);
    bus.off('job', onJob);
    bus.off('activity', onActivity);
  });
});

/** What an AI (the in-editor agent or an MCP client) is doing right now, for the editor to show. Only names and small hints, no content. */
app.post(
  '/api/activity',
  wrap((req) => {
    const b = req.body || {};
    const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);
    const tool = str(b.tool, 60);
    const projectId = str(b.projectId, 64);
    if (!tool || !projectId || !/^[\w-]+$/.test(tool)) throw new Error('tool and projectId are required');
    const hint: Record<string, string | number | boolean | string[]> = {};
    const src = b.hint && typeof b.hint === 'object' && !Array.isArray(b.hint) ? b.hint : {};
    for (const [k, v] of Object.entries(src).slice(0, 16)) {
      if (!/^\w{1,24}$/.test(k)) continue;
      if (typeof v === 'string') hint[k] = v.slice(0, 80);
      else if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') hint[k] = v;
      else if (Array.isArray(v)) hint[k] = v.slice(0, 20).map((x) => String(x).slice(0, 40));
    }
    bus.emit('activity', { projectId, tool, phase: b.phase === 'end' ? 'end' : 'start', ok: b.ok !== false, source: b.source === 'agent' ? 'agent' : 'mcp', hint, at: Date.now() });
    return { ok: true };
  }),
);

// ---------- MCP (Streamable HTTP, stateless) ----------

app.post('/mcp', async (req, res) => {
  try {
    const server = createMcp(BASE, '', 'mcp', !!(req as any).remote);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e: any) {
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: String(e.message || e) }, id: null });
  }
});
app.all('/mcp', (_req, res) => void res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST' }, id: null }));

// ---------- the editor UI ----------

if (DEV) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'mpa' });
  app.use(vite.middlewares);
} else {
  const dist = path.join(ROOT, 'dist');
  app.use(express.static(dist));
  app.get('/', (_req, res) => (fs.existsSync(path.join(dist, 'index.html')) ? res.sendFile(path.join(dist, 'index.html')) : res.status(503).send('Run "npm run build" first.')));
}

app.listen(PORT, HOST, () => {
  console.log(`YUV.AI Studio  ${BASE}\nREST API    ${BASE}/api\nMCP         ${BASE}/mcp`);
  void ensureSfx();
  // Find the Python with faster-whisper in the background: the import takes seconds and must never block requests.
  void checkPython();
});
