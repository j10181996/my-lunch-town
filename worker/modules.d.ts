declare module "*.wasm" { const value: WebAssembly.Module; export default value; }
declare module "*.bin" { const value: Uint8Array; export default value; }
declare module "sql.js/dist/sql-wasm-browser.js" {
  import initSqlJs from "sql.js";
  export type { Database, SqlValue } from "sql.js";
  export default initSqlJs;
}
