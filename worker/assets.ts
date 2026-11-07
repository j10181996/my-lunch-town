/** Resolve client routes explicitly: Sites asset bindings need not enable SPA fallback. */
export function servePageOrAsset(request: Request, assets: { fetch(request: Request): Promise<Response> }) {
  const url = new URL(request.url);
  if (["GET", "HEAD"].includes(request.method)
    && (url.pathname === "/" || /^\/(?:r|shop)\/[\w-]+\/?$/.test(url.pathname))) {
    url.pathname = "/index.html";
    return assets.fetch(new Request(url, request));
  }
  return assets.fetch(request);
}
