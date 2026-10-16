// The embed URL for a videos.json segment. videos.json is checked at build time (tools/videos), but the
// URL is built from data, so the id and times are validated again here: a bad entry gives null, never a
// URL with an extra path segment or query parameter.
export function embedSrc(v: { id: string; start: number; end: number }): string | null {
  const okTime = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (!/^[A-Za-z0-9_-]{11}$/.test(v.id) || !okTime(v.start) || !okTime(v.end) || v.end <= v.start) return null;
  return `https://www.youtube-nocookie.com/embed/${v.id}?start=${v.start}&end=${v.end}&rel=0&autoplay=1`;
}
