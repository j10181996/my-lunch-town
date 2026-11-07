import { describe, expect, it } from 'vitest';
import { layoutMapLabels, mapFontSize, overlaps, type MapLabel } from '../../web/game/text-layout';
const measure = (text: string, size: number) => Array.from(text).length * size;
const label = (id: string, x: number, y: number, kind: MapLabel['kind'] = 'store'): MapLabel =>
  ({ id, x, y, kind, text: '馬鈴薯輕食沙拉', worldSize: 5, width: 110, color: '#333' });
describe('responsive map text', () => {
  it.each([320, 375, 390, 430, 844, 1280])('keeps visible labels in bounds without overlap at %ipx', width => {
    const height = width > 600 ? 170 : 300;
    const labels = [label('shop', 80, 50), label('road', 82, 52, 'road'), label('other', 145, 50), label('name', 160, 120, 'name'), label('peer', 165, 120, 'name')];
    const placed = layoutMapLabels(labels, width, height, measure);
    expect(placed.length).toBeGreaterThan(1);
    for (const a of placed) {
      expect(a.left).toBeGreaterThanOrEqual(0);
      expect(a.left + a.boxWidth).toBeLessThanOrEqual(width);
      expect(a.top + a.boxHeight).toBeLessThanOrEqual(height);
      for (const b of placed) if (a.id !== b.id) expect(overlaps(a, b)).toBe(false);
    }
    expect(placed.some(p => p.id === 'road')).toBe(false);
  });
  it('does not drag offscreen signs into the viewport', () => {
    expect(layoutMapLabels([label('left', -1, 40), label('right', 391, 40)], 390, 300, measure)).toEqual([]);
  });
  it('recomputes size for rotation and expanded map height', () => {
    expect(mapFontSize(390, 500, 5, 'store')).toBeGreaterThan(mapFontSize(390, 170, 5, 'store'));
    expect(mapFontSize(1280, 700, 5, 'store')).toBeGreaterThan(mapFontSize(320, 220, 5, 'store'));
  });
  it('shortens long labels without squeezing glyphs, retaining source data', () => {
    const source = { ...label('long', 150, 50), width: 64 };
    const placed = layoutMapLabels([source], 320, 220, measure)[0];
    expect(placed.text.endsWith('…')).toBe(true);
    expect(source.text).toBe('馬鈴薯輕食沙拉');
  });
  it('prioritizes active conversation over scenery', () => {
    const placed = layoutMapLabels([label('road', 90, 70, 'road'), label('talk', 90, 70, 'bubble')], 390, 300, measure);
    expect(placed.map(p => p.id)).toEqual(['talk']);
  });
});
