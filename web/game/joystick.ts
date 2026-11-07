/** CSS 座標轉單位向量；中心留死區，外圈夾限，保留類比速度。 */
export function joystickVector(dx: number, dy: number, radius = 38) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(radius) || radius <= 8) return { x: 0, y: 0 };
  const distance = Math.hypot(dx, dy);
  if (distance <= 8) return { x: 0, y: 0 };
  const strength = Math.min(1, (distance - 8) / (radius - 8));
  return { x: dx / distance * strength, y: dy / distance * strength };
}
