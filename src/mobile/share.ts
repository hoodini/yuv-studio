// A file shared to the studio from the phone's share sheet. public/sw.js receives the POST from the share sheet
// and parks the file in a cache; the mobile mode takes it from there and uploads it in chunks like any pick.
const CACHE = 'studio-share';
const KEY = '/__shared-file';

export async function takeShared(): Promise<File | null> {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(CACHE);
    const res = await cache.match(KEY);
    if (!res) return null;
    await cache.delete(KEY);
    const name = decodeURIComponent(res.headers.get('x-file-name') || 'shared-video.mp4');
    const blob = await res.blob();
    return new File([blob], name, { type: blob.type || 'video/mp4' });
  } catch {
    return null;
  }
}
