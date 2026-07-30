// Pure helpers for turning arbitrary media URLs into embeddable sources.

export type Embed = { type: string; src: string };

/** Rewrite Dropbox share links so the raw file is served inline. */
export function rawDbx(u: string): string {
  return u.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/([?&])dl=0/, "$1raw=1");
}

/** Detect the embed type/source for a media URL, or null when unsupported. */
export function embedOf(url: string): Embed | null {
  if (!url) return null;
  const u = url.trim();
  let m = u.match(/voca(?:roo)?\.(?:com|ro)\/(?:embed\/)?([A-Za-z0-9]+)/i);
  if (m && /voca/i.test(u)) return { type: "audio", src: `https://vocaroo.com/embed/${m[1]}?autoplay=0` };
  m = u.match(/loom\.com\/(?:share|embed)\/([A-Za-z0-9]+)/i);
  if (m) return { type: "iframe", src: `https://www.loom.com/embed/${m[1]}` };
  m = u.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=)([A-Za-z0-9_-]+)/i);
  if (m) return { type: "iframe", src: `https://www.youtube.com/embed/${m[1]}` };
  m = u.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/i);
  if (m) return { type: "iframe", src: `https://drive.google.com/file/d/${m[1]}/preview` };
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(u)) return { type: "video", src: rawDbx(u) };
  if (/\.(mp3|wav|ogg|m4a)(\?|$)/i.test(u)) return { type: "audiofile", src: rawDbx(u) };
  if (/\.pdf(\?|$)/i.test(u)) return { type: "pdf", src: rawDbx(u) };
  return null;
}
