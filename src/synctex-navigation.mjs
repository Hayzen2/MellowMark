const MAX_SOURCE_REGION_HEIGHT = 8_000_000;

export function findSourceAt(locations, page, x, y) {
  let nearest = null;
  let nearestDistance = Infinity;
  let nearestArea = Infinity;
  for (const location of locations) {
    if (location.page !== page || location.height > MAX_SOURCE_REGION_HEIGHT) continue;
    const dx = Math.max(location.x - x, 0, x - (location.x + location.width));
    const dy = Math.max(location.y - y, 0, y - (location.y + location.height));
    const distance = dx * dx + dy * dy;
    const area = Math.max(location.width, 1) * Math.max(location.height, 1);
    if (distance < nearestDistance || (distance === nearestDistance && area < nearestArea)) {
      nearest = location;
      nearestDistance = distance;
      nearestArea = area;
    }
  }
  return nearest;
}
