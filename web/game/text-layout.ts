/** All geometry is in CSS pixels; rendering applies DPR only after layout. */
export interface MapLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  worldSize: number;
  width: number;
  kind: 'store' | 'road' | 'vacant' | 'name' | 'bubble' | 'info';
  color: string;
  background?: string;
  priority?: number;
}
export interface PlacedLabel extends MapLabel {
  fontSize: number;
  left: number;
  top: number;
  boxWidth: number;
  boxHeight: number;
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export function mapFontSize(width: number, height: number, worldSize: number, kind: MapLabel['kind']) {
  // Both width and height matter: landscape and collapsed menus change the canvas.
  const space = Math.min(width, height * 1.5);
  const minimum = kind === 'store' || kind === 'info' ? 12 : 11;
  const preferred = minimum + clamp((space - 280) / 160, 0, 4);
  return clamp(Math.max(worldSize, preferred), minimum, kind === 'info' ? 20 : 18);
}
export function overlaps(a: Pick<PlacedLabel, 'left' | 'top' | 'boxWidth' | 'boxHeight'>, b: Pick<PlacedLabel, 'left' | 'top' | 'boxWidth' | 'boxHeight'>) {
  return a.left < b.left + b.boxWidth + 3 && a.left + a.boxWidth + 3 > b.left &&
    a.top < b.top + b.boxHeight + 3 && a.top + a.boxHeight + 3 > b.top;
}
const priorities = { bubble: 110, name: 100, info: 95, store: 80, road: 20, vacant: 10 };
export function layoutMapLabels(labels: MapLabel[], width: number, height: number,
  measure: (text: string, fontSize: number, kind: MapLabel['kind']) => number): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  if (width < 24 || height < 24) return placed;
  for (const label of [...labels].sort((a, b) => (b.priority ?? priorities[b.kind]) - (a.priority ?? priorities[a.kind]))) {
    // Never pull off-camera signs onto an edge: that piles up unrelated labels.
    if (label.x < 0 || label.x > width || label.y < 0 || label.y > height) continue;
    if (label.kind === 'vacant' && width < 600) continue;
    const size = mapFontSize(width, height, label.worldSize, label.kind);
    const maxWidth = Math.min(width - 16, label.kind === 'name' ? width * .42 : label.width);
    const chars = Array.from(label.text);
    let text = label.text;
    while (chars.length && measure(text, size, label.kind) > maxWidth - 8) {
      chars.pop(); text = chars.join('') + '…';
    }
    if (!chars.length) continue;
    const boxWidth = measure(text, size, label.kind) + 8;
    const boxHeight = Math.ceil(size * 1.35) + 4;
    const left = clamp(label.x - boxWidth / 2, 4, width - boxWidth - 4);
    const offsets = label.kind === 'name' || label.kind === 'bubble' ? [0, -boxHeight - 4, boxHeight + 4] : [0];
    for (const offset of offsets) {
      const top = clamp(label.y - boxHeight / 2 + offset, 4, height - boxHeight - 4);
      const candidate = { ...label, text, fontSize: size, left, top, boxWidth, boxHeight };
      if (placed.some(other => overlaps(candidate, other))) continue;
      placed.push(candidate); break;
    }
  }
  return placed;
}
