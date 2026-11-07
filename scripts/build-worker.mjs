import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

mkdirSync("dist/server", { recursive: true });
await build({
  entryPoints: ["worker/index.ts"], outfile: "dist/server/index.js",
  bundle: true, format: "esm", platform: "browser", target: "es2022",
  minify: true, external: ["node:crypto", "./sqlite.wasm"],
  loader: { ".bin": "binary" },
  plugins: [{ name: "worker-database", setup(build) {
    build.onLoad({ filter: /sql-wasm-browser\.js$/ }, (args) => {
      // Emscripten's browser loader assumes all WorkerGlobals have a Location.
      // Cloudflare has none; its loader is unused because WASM is precompiled.
      const source = readFileSync(args.path, "utf8");
      if (!source.includes("self.location.href")) throw new Error("Recheck sql.js Worker compatibility after upgrade");
      return { contents: source.replace("self.location.href", "self.location?.href"), loader: "js" };
    });
    build.onResolve({ filter: /^(\.\/|\.\.\/).*db$/ }, (args) => {
      if (resolve(args.resolveDir, args.path + ".ts") === resolve("server/db.ts")) return { path: resolve("worker/db.ts") };
    });
  } }],
});
cpSync("node_modules/sql.js/dist/sql-wasm-browser.wasm", "dist/server/sqlite.wasm");
mkdirSync("dist/.openai", { recursive: true });
cpSync(".openai/hosting.json", "dist/.openai/hosting.json");
cpSync("drizzle", "dist/.openai/drizzle", { recursive: true });
