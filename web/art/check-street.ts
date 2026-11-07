import { LOTS, STREET_H, STREET_W } from "../../shared/town";
import { checkStreet } from "./street-check";
import { streetLayout } from "./street-layout";

const start = performance.now();
const layout = streetLayout();
const result = checkStreet(layout.colliders);
console.log(`${result.passed ? "通過" : "失敗"} ${STREET_W}×${STREET_H}：` +
  `${result.reachableDoors}/${LOTS.length} 門口可達，4px BFS 探索 ${result.visited} 格；` +
  `門前／道路／出生點／建築碰撞檢查，${(performance.now() - start).toFixed(1)}ms`);
for (const failure of result.failures) console.error(failure);
process.exitCode = result.passed ? 0 : 1;
