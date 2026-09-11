const assert = require('assert');
const {
  xpRequiredForLevel,
  getLevelFromXp,
  getProgressInfo,
} = require('../src/utils/xpFormula');

assert.strictEqual(xpRequiredForLevel(0), 0);
assert.strictEqual(xpRequiredForLevel(1), 100);
assert.strictEqual(xpRequiredForLevel(-1), -100);
assert.strictEqual(getLevelFromXp(0), 0);
assert.strictEqual(getLevelFromXp(99), 0);
assert.strictEqual(getLevelFromXp(100), 1);
assert.strictEqual(getLevelFromXp(-1), -1);
assert.strictEqual(getLevelFromXp(-100), -1);
assert.strictEqual(getLevelFromXp(-101), -2);
assert.ok(getLevelFromXp(-5000) < 0);
const p = getProgressInfo(-50);
assert.strictEqual(p.level, -1);
assert.ok(p.needed > 0);
console.log('ok xpFormula', { neg5k: getLevelFromXp(-5000), neg1k: getLevelFromXp(-1000) });
