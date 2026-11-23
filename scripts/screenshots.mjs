// Regenerates the README screenshots from a running studio:
//   node scripts/screenshots.mjs <projectId> [baseUrl]
// The project should have a video clip, a title, a few captions and a sound effect on the timeline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const [projectId, base = 'http://127.0.0.1:5177'] = process.argv.slice(2);
if (!projectId) throw new Error('usage: node scripts/screenshots.mjs <projectId> [baseUrl]');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
fs.mkdirSync(out, { recursive: true });
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && fs.existsSync(p));
/** The timeline opens at 80 px per second. */
const ZOOM = 80;

const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1.5 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(lang) {
  await page.goto(`${base}/?project=${projectId}`, { waitUntil: 'networkidle2' });
  await page.evaluate((l) => localStorage.setItem('studio.lang', l), lang);
  await page.goto(`${base}/?project=${projectId}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.clip');
  await sleep(800);
}
/** A pointer press on an element, the way the timeline listens for it. */
const press = (selector, pick = 'first', dx = 20) =>
  page.evaluate(
    (s, which, x) => {
      const all = [...document.querySelectorAll(s)];
      const el = which === 'last' ? all.pop() : all[0];
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + x, clientY: r.top + 8, button: 0 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    },
    selector,
    pick,
    dx,
  );
/** Move the playhead by pressing the ruler, then wait for the video frame to arrive. */
async function seek(t) {
  await press('.tl-ruler', 'first', t * ZOOM);
  await sleep(900);
}
const click = (selector, index = 0) => page.evaluate((s, i) => document.querySelectorAll(s)[i]?.click(), selector, index);
const shot = async (name) => {
  await sleep(500);
  await page.screenshot({ path: path.join(out, name) });
  console.log('wrote', name);
};

// 1. The editor, Hebrew interface.
await open('he');
await seek(1.2);
await shot('editor.png');

/** Wait until a label that starts as "…" while settings load has its real text. */
const settled = (selector) => page.waitForFunction((q) => [...document.querySelectorAll(q)].every((e) => e.textContent.trim() && e.textContent.trim() !== '…'), { timeout: 8000 }, selector).catch(() => {});

// 2. Fixing the transcription.
await click('.tabs button[data-tab="captions"]');
await sleep(300);
await click('.seg.big button', 2);
await sleep(2500);
await seek(2.6);
await settled('.tab-body .engine-chip');
await shot('captions.png');

// 3. Titles, with a text clip selected so the inspector shows its style.
await click('.tabs button[data-tab="text"]');
await seek(1.2);
await press('.clip-text');
await shot('titles.png');

// 4. Sounds, and a video clip's transitions in the inspector.
await click('.tabs button[data-tab="sounds"]');
await seek(3.35);
await press('.clip-video');
await page.evaluate(() => (document.querySelector('.insp-body').scrollTop = 99999));
await shot('sounds-transitions.png');

// 5. Narration with Cartesia: the voice list.
await click('.tabs button[data-tab="voice"]');
await sleep(2500);
// The public pictures do not name the voice provider or its model.
await settled('.tab-body .engine-chip');
await page.evaluate(() => {
  for (const e of document.querySelectorAll('.tab-body:not(.agent-tab) .engine-chip')) e.style.visibility = 'hidden';
});
await shot('voice.png');

// 6. The credit.
await click('.brand-btn');
await page.waitForFunction(() => !document.querySelector('.avatar img') || document.querySelector('.avatar img').complete, { timeout: 8000 }).catch(() => {});
await sleep(1200);
await shot('about.png');
await click('.dialog .icon-btn');

// 6b. The AI agent tab.
await click('.tabs button[data-tab="agent"]');
await sleep(800);
await shot('agent.png');

// 6c. Export with the social presets.
await click('.topbar .cta');
await sleep(400);
await page.evaluate(() => [...document.querySelectorAll('.preset-chips .chip-btn')][3]?.click());
await shot('export-presets.png');
await click('.dialog .icon-btn');

// 7. Export dialog.
await click('.topbar .cta');
await shot('export.png');
await click('.dialog .icon-btn');

// 8. English interface.
await open('en');
await seek(3.4);
await shot('editor-en.png');

await page.evaluate(() => localStorage.setItem('studio.lang', 'he'));
await browser.close();
