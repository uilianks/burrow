/** An http(s) address as typed by a person, with the scheme added when missing; null if it is anything else. */
export function webUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".") ? url.href : null;
  } catch {
    return null;
  }
}

/** The address to put in a frame for a page: the player for known video sites, otherwise the page itself. */
export function embedUrl(address: string): string | null {
  const href = webUrl(address);
  if (!href) return null;
  const url = new URL(href);
  const host = url.hostname.replace(/^www\./, "");
  const id = /^[\w-]{6,}$/;
  if (host === "youtu.be" && id.test(url.pathname.slice(1))) return `https://www.youtube-nocookie.com/embed/${url.pathname.slice(1)}`;
  if (host === "youtube.com" || host === "m.youtube.com") {
    const video = url.searchParams.get("v") ?? /^\/(?:shorts|embed)\/([\w-]+)/.exec(url.pathname)?.[1];
    if (video && id.test(video)) return `https://www.youtube-nocookie.com/embed/${video}`;
  }
  if (host === "vimeo.com" && /^\/\d+$/.test(url.pathname)) return `https://player.vimeo.com/video${url.pathname}`;
  return url.protocol === "https:" ? href : null;
}
