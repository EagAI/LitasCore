const BASE_XP = 100;
const MULTIPLIER = 1.3;

/** Kiek XP reikia pasiekti nurodytą lygį (gali būti neigiamas). */
function xpRequiredForLevel(level) {
  if (!Number.isFinite(level) || level === 0) return 0;
  const steps = Math.abs(level);
  let total = 0;
  for (let i = 1; i <= steps; i++) {
    total += Math.floor(BASE_XP * Math.pow(MULTIPLIER, i - 1));
  }
  return level > 0 ? total : -total;
}

function getLevelFromXp(xp) {
  const n = Number(xp);
  if (!Number.isFinite(n)) return 0;

  if (n >= 0) {
    let level = 0;
    while (xpRequiredForLevel(level + 1) <= n && level < 10_000) {
      level++;
    }
    return level;
  }

  let level = 0;
  while (n < xpRequiredForLevel(level) && level > -10_000) {
    level--;
  }
  return level;
}

function getProgressInfo(xp) {
  const n = Number(xp);
  const safeXp = Number.isFinite(n) ? n : 0;
  const level = getLevelFromXp(safeXp);
  const currentFloor = xpRequiredForLevel(level);
  const nextCeiling = xpRequiredForLevel(level + 1);
  const needed = nextCeiling - currentFloor;
  const current = safeXp - currentFloor;
  const rawPercent = needed > 0 ? Math.floor((current / needed) * 100) : 0;
  const percent = Math.max(0, Math.min(100, rawPercent));
  return { level, current, needed, percent };
}

module.exports = {
  BASE_XP,
  MULTIPLIER,
  xpRequiredForLevel,
  getLevelFromXp,
  getProgressInfo,
};
