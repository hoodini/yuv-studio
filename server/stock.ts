// Free stock media: B-roll, overlays, photos, music and sound effects from sources that allow use in videos.
//   Openverse - CC-licensed images and audio, no key (credit the author where the licence asks for it)
//   Pexels    - videos and photos, free key (pexels.com/api), free to use, no credit required
//   Pixabay   - videos and images, free key (pixabay.com/api/docs), free to use, no credit required
// Searches go out from the studio (the keys never reach the browser) through fetchPublic, which sends each key only
// to its own host. Results are normalised to one shape; importing reuses the import-by-link job.
// Mixkit has no public API (its licence allows use, but not automated downloading), so it is offered as a link.
import { fetchPublic } from './fetchUrl';
import { loadSettings } from './settings';

export type StockSource = 'openverse' | 'pexels' | 'pixabay';
export type StockKind = 'video' | 'image' | 'audio';

export interface StockItem {
  id: string;
  source: StockSource;
  kind: StockKind;
  title: string;
  /** Small picture for the grid (for audio: the source's waveform or nothing). */
  thumb: string;
  /** A small video / audio to play on hover, when the source has one. */
  preview: string;
  /** The file to import: the best version up to 1080p. */
  url: string;
  width?: number;
  height?: number;
  duration?: number;
  creator: string;
  license: string;
  licenseUrl: string;
  pageUrl: string;
  /** One line to put in the video's description or credits; empty when the source needs none. */
  credit: string;
}

export const STOCK_SOURCES: Record<StockSource, { label: string; kinds: StockKind[]; needsKey: boolean; keyUrl: string; terms: string }> = {
  openverse: { label: 'Openverse', kinds: ['image', 'audio'], needsKey: false, keyUrl: '', terms: 'https://openverse.org/terms' },
  pexels: { label: 'Pexels', kinds: ['video', 'image'], needsKey: true, keyUrl: 'https://www.pexels.com/api/new/', terms: 'https://www.pexels.com/license/' },
  pixabay: { label: 'Pixabay', kinds: ['video', 'image'], needsKey: true, keyUrl: 'https://pixabay.com/api/docs/#api_key', terms: 'https://pixabay.com/service/license-summary/' },
};

export function stockKey(source: StockSource) {
  const s = loadSettings().stock;
  if (source === 'pexels') return s.pexelsKey || process.env.PEXELS_API_KEY || '';
  if (source === 'pixabay') return s.pixabayKey || process.env.PIXABAY_API_KEY || '';
  return '';
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const host = new URL(url).host;
  // the key travels only to the host it belongs to, never along a redirect
  // A plain client name: Openverse answers 401 to requests without one. No user details go out.
  const ua = { 'user-agent': 'YUV-AI-Studio/1.0 (video editor)', accept: 'application/json' };
  const once = () => fetchPublic(url, 4_000_000, (u) => (u.host === host ? { ...ua, ...headers } : ua));
  let body: Buffer;
  try {
    ({ body } = await once());
  } catch (e: any) {
    // Openverse's image search times out now and then (502 / 503 / 504): one more try before giving up.
    if (!/answered 5\d\d|timed out/.test(String(e?.message))) throw e;
    try {
      ({ body } = await once());
    } catch (e2: any) {
      throw Object.assign(new Error(`${host} is slow or down right now (${String(e2?.message || e2).replace('The address answered ', '')}). Try again in a moment, or another source.`), { status: 502 });
    }
  }
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new Error('The stock service answered with something that is not JSON');
  }
}

// Openverse answers 401 to anonymous requests for more than 20 results per page.
const PER_PAGE = 20;

async function openverse(kind: StockKind, q: string, page: number): Promise<StockItem[]> {
  if (kind === 'video') throw Object.assign(new Error('Openverse has images and audio. For videos, use Pexels or Pixabay (free key).'), { status: 400 });
  const ep = kind === 'image' ? 'images' : 'audio';
  const params = new URLSearchParams({ q, page: String(page), page_size: String(PER_PAGE), mature: 'false' });
  // Only licences that allow use in a video that may be commercial and edited.
  params.set('license_type', 'commercial,modification');
  const data = await getJson(`https://api.openverse.org/v1/${ep}/?${params}`);
  return (data.results || []).map((r: any): StockItem => {
    const lic = `${String(r.license || '').toUpperCase()}${r.license_version ? ` ${r.license_version}` : ''}`;
    const needsCredit = !/^(cc0|pdm)$/i.test(String(r.license || ''));
    return {
      id: `openverse:${r.id}`,
      source: 'openverse',
      kind,
      title: r.title || '',
      thumb: r.thumbnail || (kind === 'image' ? r.url : ''),
      preview: kind === 'audio' ? r.url : '',
      url: r.url,
      width: r.width || undefined,
      height: r.height || undefined,
      duration: r.duration ? r.duration / 1000 : undefined,
      creator: r.creator || '',
      license: lic,
      licenseUrl: r.license_url || '',
      pageUrl: r.foreign_landing_url || '',
      credit: needsCredit ? `"${r.title || 'Untitled'}" by ${r.creator || 'unknown'} (${lic}) ${r.foreign_landing_url || ''}`.trim() : '',
    };
  });
}

async function pexels(kind: StockKind, q: string, page: number, key: string): Promise<StockItem[]> {
  if (kind === 'audio') throw Object.assign(new Error('Pexels has videos and photos. For music and sounds, use Openverse or Pixabay.'), { status: 400 });
  const h = { authorization: key };
  if (kind === 'video') {
    const data = await getJson(`https://api.pexels.com/videos/search?${new URLSearchParams({ query: q, page: String(page), per_page: String(PER_PAGE) })}`, h);
    return (data.videos || []).map((v: any): StockItem => {
      const files: any[] = (v.video_files || []).filter((f: any) => f.link && /mp4/.test(f.file_type || 'mp4'));
      // the largest file up to 1080p tall (or wide, for vertical clips), else the smallest one there is
      const fits = files.filter((f) => Math.min(f.width || 0, f.height || 0) <= 1080).sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
      const best = fits[0] || files.sort((a, b) => (a.width || 0) - (b.width || 0))[0];
      const small = [...files].sort((a, b) => (a.width || 0) - (b.width || 0))[0];
      return {
        id: `pexels:v${v.id}`,
        source: 'pexels',
        kind,
        title: String(v.url || '').split('/').filter(Boolean).pop()?.replace(/-\d+$/, '').replace(/-/g, ' ') || 'Pexels video',
        thumb: v.image || '',
        preview: small?.link || '',
        url: best?.link || '',
        width: best?.width || v.width,
        height: best?.height || v.height,
        duration: v.duration,
        creator: v.user?.name || '',
        license: 'Pexels License',
        licenseUrl: STOCK_SOURCES.pexels.terms,
        pageUrl: v.url || '',
        credit: '',
      };
    });
  }
  const data = await getJson(`https://api.pexels.com/v1/search?${new URLSearchParams({ query: q, page: String(page), per_page: String(PER_PAGE) })}`, h);
  return (data.photos || []).map(
    (p: any): StockItem => ({
      id: `pexels:p${p.id}`,
      source: 'pexels',
      kind,
      title: p.alt || 'Pexels photo',
      thumb: p.src?.medium || p.src?.small || '',
      preview: '',
      url: p.src?.large2x || p.src?.original || '',
      width: p.width,
      height: p.height,
      creator: p.photographer || '',
      license: 'Pexels License',
      licenseUrl: STOCK_SOURCES.pexels.terms,
      pageUrl: p.url || '',
      credit: '',
    }),
  );
}

async function pixabay(kind: StockKind, q: string, page: number, key: string): Promise<StockItem[]> {
  const base = { key, q, page: String(page), per_page: String(PER_PAGE), safesearch: 'true' };
  if (kind === 'video') {
    const data = await getJson(`https://pixabay.com/api/videos/?${new URLSearchParams(base)}`);
    return (data.hits || []).map((v: any): StockItem => {
      const vs = v.videos || {};
      const best = [vs.large, vs.medium, vs.small, vs.tiny].find((f: any) => f?.url && Math.min(f.width || 0, f.height || 0) <= 1080 && f.width) || vs.medium || vs.small;
      const small = vs.tiny?.url ? vs.tiny : vs.small;
      return {
        id: `pixabay:v${v.id}`,
        source: 'pixabay',
        kind,
        title: v.tags || 'Pixabay video',
        thumb: small?.thumbnail || vs.medium?.thumbnail || '',
        preview: small?.url || '',
        url: best?.url || '',
        width: best?.width,
        height: best?.height,
        duration: v.duration,
        creator: v.user || '',
        license: 'Pixabay Content License',
        licenseUrl: STOCK_SOURCES.pixabay.terms,
        pageUrl: v.pageURL || '',
        credit: '',
      };
    });
  }
  if (kind === 'audio') throw Object.assign(new Error("Pixabay's music has no public API. Use Openverse for music and sounds, or download from pixabay.com/music and drop the file in."), { status: 400 });
  const data = await getJson(`https://pixabay.com/api/?${new URLSearchParams({ ...base, image_type: 'all' })}`);
  return (data.hits || []).map(
    (p: any): StockItem => ({
      id: `pixabay:p${p.id}`,
      source: 'pixabay',
      kind,
      title: p.tags || 'Pixabay image',
      thumb: p.webformatURL || p.previewURL || '',
      preview: '',
      url: p.largeImageURL || p.webformatURL || '',
      width: p.imageWidth,
      height: p.imageHeight,
      creator: p.user || '',
      license: 'Pixabay Content License',
      licenseUrl: STOCK_SOURCES.pixabay.terms,
      pageUrl: p.pageURL || '',
      credit: '',
    }),
  );
}

export async function searchStock(source: StockSource, kind: StockKind, q: string, page = 1): Promise<{ items: StockItem[]; source: StockSource; kind: StockKind }> {
  if (!STOCK_SOURCES[source]) throw Object.assign(new Error(`Unknown source "${source}"`), { status: 400 });
  if (!['video', 'image', 'audio'].includes(kind)) throw Object.assign(new Error(`Unknown kind "${kind}"`), { status: 400 });
  const query = q.trim().slice(0, 100);
  if (!query) throw Object.assign(new Error('Type what to search for'), { status: 400 });
  const pg = Math.max(1, Math.min(50, Math.floor(page) || 1));
  const key = stockKey(source);
  if (STOCK_SOURCES[source].needsKey && !key) throw Object.assign(new Error(`${STOCK_SOURCES[source].label} needs a free API key. Get one at ${STOCK_SOURCES[source].keyUrl} and paste it in the Stock tab settings.`), { status: 400, code: 'needs_key' });
  const items = source === 'openverse' ? await openverse(kind, query, pg) : source === 'pexels' ? await pexels(kind, query, pg, key) : await pixabay(kind, query, pg, key);
  return { items: items.filter((i) => i.url), source, kind };
}

/** Which sources can be used right now, and where to get a key for the others. */
export function stockStatus() {
  return Object.entries(STOCK_SOURCES).map(([id, s]) => {
    const key = stockKey(id as StockSource);
    return { id, label: s.label, kinds: s.kinds, needsKey: s.needsKey, hasKey: !!key, keyHint: key ? `…${key.slice(-4)}` : '', keyUrl: s.keyUrl, terms: s.terms };
  });
}
