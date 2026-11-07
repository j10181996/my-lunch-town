import { describe, it, expect } from "vitest";
import { servePageOrAsset } from "./assets";
const assets = { async fetch(request: Request) {
  return new Response(request.method === "HEAD" ? null : "<html>Lunch Town</html>", {
    status: new URL(request.url).pathname === "/index.html" ? 200 : 404,
    headers: { "content-type": "text/html" },
  });
} };
describe("Sites direct page navigation without SPA asset fallback", () => {
  for (const path of ["/", "/r/hgafccbf", "/r/hgafccbf/", "/r/hgafccbf?view=side", "/shop/new", "/shop/store-1"]) {
    it(`loads ${path}`, async () => {
      const response = await servePageOrAsset(new Request(`https://town.test${path}`), assets);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Lunch Town");
    });
  }
  it("preserves missing assets and unknown paths as 404", async () => {
    for (const path of ["/assets/missing.js", "/unknown", "/r/room/bad"]) {
      expect((await servePageOrAsset(new Request(`https://town.test${path}`), assets)).status).toBe(404);
    }
  });
});
