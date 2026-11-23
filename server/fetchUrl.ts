// Download a media file from a public URL into the studio (e.g. a clip made by an AI video tool).
// The studio can be reachable from the internet, so this must never become a way to read the home
// network: only http(s), only public addresses, and the address is checked at the moment of connecting
// (inside the DNS lookup), so a host name cannot pass the check and then point somewhere else.
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { uid } from '../shared/types';
import { DIRS } from './store';

const blocked = new net.BlockList();
for (const [addr, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(addr, bits, 'ipv4');
for (const [addr, bits] of [
  ['::', 127], // :: and ::1
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(addr, bits, 'ipv6');

export function isPublicAddress(address: string) {
  const family = net.isIP(address);
  if (!family) return false;
  // IPv4 written as IPv6 (::ffff:10.0.0.1) is judged as the IPv4 address it is.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return !blocked.check(mapped[1], 'ipv4');
  return !blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

const refuse = (host: string) => Object.assign(new Error(`Refused: ${host} is not a public internet address`), { status: 400 });

const publicLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...(options as dns.LookupOptions), all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => !isPublicAddress(a.address))) return callback(refuse(hostname), '', 0);
    if ((options as dns.LookupOptions).all) return (callback as any)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

/**
 * True when the first bytes are those of a real media container. A playlist or script renamed to .mp4 is text,
 * and handing text like that to ffmpeg would let it name other files and addresses for ffmpeg to open.
 */
export function looksLikeMedia(head: Buffer) {
  const at = (s: string, o = 0) => head.length >= o + s.length && head.toString('latin1', o, o + s.length) === s;
  const bytes = (o: number, ...b: number[]) => b.every((v, i) => head[o + i] === v);
  return (
    (head.length >= 12 && ['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip'].some((box) => at(box, 4))) || // mp4, mov, m4a, avif
    bytes(0, 0x1a, 0x45, 0xdf, 0xa3) || // webm, mkv
    (at('RIFF') && (at('WAVE', 8) || at('WEBP', 8))) ||
    at('ID3') ||
    (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) || // mp3 or aac frames
    at('OggS') ||
    at('fLaC') ||
    bytes(0, 0x89, 0x50, 0x4e, 0x47) || // png
    bytes(0, 0xff, 0xd8, 0xff) || // jpeg
    at('GIF8') ||
    at('BM')
  );
}

/**
 * Fetch a small file from a public https address into memory (no redirects to private places, size-capped).
 * `headersFor` decides per address which headers to send, so a key is never carried along a redirect to another host.
 */
export async function fetchPublic(link: string, maxBytes: number, headersFor: (url: URL) => Record<string, string> = () => ({})): Promise<{ type: string; body: Buffer }> {
  let url = new URL(link);
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== 'https:') throw new Error('Only https addresses are accepted');
    const res = await get(url, 20000, headersFor(url));
    const code = res.statusCode || 0;
    if (code >= 300 && code < 400 && res.headers.location) {
      res.resume();
      url = new URL(res.headers.location, url);
      continue;
    }
    if (code !== 200) {
      res.resume();
      throw new Error(`The address answered ${code}`);
    }
    const chunks: Buffer[] = [];
    let got = 0;
    for await (const chunk of res) {
      got += chunk.length;
      if (got > maxBytes) {
        res.destroy();
        throw new Error('The file is too large');
      }
      chunks.push(chunk);
    }
    return { type: String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase(), body: Buffer.concat(chunks) };
  }
  throw new Error('Too many redirects');
}

const EXT_BY_TYPE: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};
const KNOWN_EXT = new Set(Object.values(EXT_BY_TYPE).concat(['.m4v', '.jpeg', '.opus', '.bmp']));
const MAX_BYTES = Number(process.env.STUDIO_MAX_DOWNLOAD_MB || 2048) * 1024 * 1024;

function get(url: URL, timeoutMs: number, headers: Record<string, string> = {}): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return reject(Object.assign(new Error('Only http and https links can be imported'), { status: 400 }));
    if (url.username || url.password) return reject(Object.assign(new Error('Links with a user name or password are not accepted'), { status: 400 }));
    const host = url.hostname.replace(/^\[|\]$/g, '');
    // An address written directly in the link never goes through the lookup, so it is checked here.
    if (net.isIP(host) && !isPublicAddress(host)) return reject(refuse(host));
    const req = (url.protocol === 'https:' ? https : http).get(url, { lookup: publicLookup, headers: { 'user-agent': 'yuv-studio', accept: '*/*', ...headers }, timeout: timeoutMs }, resolve);
    req.on('timeout', () => req.destroy(new Error('The download timed out')));
    req.on('error', reject);
  });
}

/** Download `link` into data/media and return the saved file and a display name. */
export async function downloadMedia(link: string, update: (progress: number, message?: string) => void = () => {}): Promise<{ file: string; name: string }> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw Object.assign(new Error('That is not a valid link'), { status: 400 });
  }
  let res: http.IncomingMessage | undefined;
  for (let hop = 0; hop < 6; hop++) {
    res = await get(url, 30000);
    const code = res.statusCode || 0;
    if (code >= 300 && code < 400 && res.headers.location) {
      res.resume();
      url = new URL(res.headers.location, url); // every redirect target is checked again by get()
      res = undefined;
      continue;
    }
    if (code !== 200) {
      res.resume();
      throw new Error(`The server answered ${code} for this link`);
    }
    break;
  }
  if (!res) throw new Error('Too many redirects');

  const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const urlExt = path.extname(url.pathname).toLowerCase();
  const ext = KNOWN_EXT.has(urlExt) ? urlExt : EXT_BY_TYPE[type];
  if (!ext) {
    res.destroy();
    throw new Error(`This link is not a video, audio or image file (${type || 'unknown type'}). Use the direct link to the file itself.`);
  }
  const total = Number(res.headers['content-length'] || 0);
  if (total > MAX_BYTES) {
    res.destroy();
    throw new Error(`The file is larger than ${Math.round(MAX_BYTES / 1048576)} MB`);
  }
  const file = path.join(DIRS.media, `${uid('u_')}${ext}`);
  const out = fs.createWriteStream(file);
  let got = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      res!.on('data', (chunk: Buffer) => {
        got += chunk.length;
        if (got > MAX_BYTES) return res!.destroy(new Error(`The file is larger than ${Math.round(MAX_BYTES / 1048576)} MB`));
        update(total ? got / total : 0, `${(got / 1048576).toFixed(1)} MB`);
      });
      res!.on('error', reject);
      res!.on('close', () => !res!.complete && reject(new Error('The download was cut off')));
      out.on('error', reject);
      out.on('finish', resolve);
      res!.pipe(out);
    });
  } catch (e) {
    out.destroy();
    fs.rmSync(file, { force: true });
    throw e;
  }
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r');
  const read = fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (!looksLikeMedia(head.subarray(0, read))) {
    fs.rmSync(file, { force: true });
    throw new Error('The downloaded file is not a video, audio or image file');
  }
  const base = decodeURIComponent(path.basename(url.pathname)) || url.hostname;
  return { file, name: path.extname(base) ? base : base + ext };
}
