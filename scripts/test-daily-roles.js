/**
 * Dienos roles logikos smoke testai (be Discord).
 * Paleisti: node scripts/test-daily-roles.js
 */
const assert = require('assert');
const {
  getVilniusDateString,
  getVilniusParts,
  shouldAttemptPost,
  pickThreeMembers,
  buildDailyRolesMessage,
  wasPostedToday,
  markPostedToday,
  getLastPinnedMessageId,
  setLastPinnedMessageId,
} = require('../src/services/dailyRoles');

function testDateString() {
  const s = getVilniusDateString(new Date('2026-08-31T03:30:00.000Z'));
  assert.match(s, /^\d{4}-\d{2}-\d{2}$/, 'date format');
  console.log('  ok getVilniusDateString:', s);
}

function testShouldAttemptPost() {
  const guildId = 'test-guild-should-attempt';

  // Before 06:30 — no post
  assert.strictEqual(shouldAttemptPost(guildId, '2099-01-01', 6, 29), false);
  assert.strictEqual(shouldAttemptPost(guildId, '2099-01-01', 5, 59), false);

  // At 06:30 — yes
  assert.strictEqual(shouldAttemptPost(guildId, '2099-01-01', 6, 30), true);
  // Same minute guard — no duplicate
  assert.strictEqual(shouldAttemptPost(guildId, '2099-01-01', 6, 30), false);

  // After 06:30 — catch-up yes
  assert.strictEqual(shouldAttemptPost(guildId, '2099-01-02', 10, 0), true);

  console.log('  ok shouldAttemptPost');
}

function testPickThree() {
  const members = [
    { id: '1', user: { bot: false } },
    { id: '2', user: { bot: false } },
    { id: '3', user: { bot: false } },
    { id: '4', user: { bot: true } },
    { id: '5', user: { bot: false } },
  ];
  const picked = pickThreeMembers(members);
  assert.strictEqual(picked.length, 3);
  assert.ok(picked.every(m => !m.user.bot));
  assert.strictEqual(new Set(picked.map(m => m.id)).size, 3);

  const tooFew = pickThreeMembers([
    { id: '1', user: { bot: false } },
    { id: '2', user: { bot: true } },
  ]);
  assert.strictEqual(tooFew.length, 1);

  console.log('  ok pickThreeMembers');
}

function testPinnedMessageId() {
  const guildId = 'test-guild-pin-' + Date.now();
  assert.strictEqual(getLastPinnedMessageId(guildId), null);
  setLastPinnedMessageId(guildId, '1234567890123456789');
  assert.strictEqual(getLastPinnedMessageId(guildId), '1234567890123456789');
  console.log('  ok pinned message id storage');
}

function testDedup() {
  const guildId = 'test-guild-dedup-' + Date.now();
  const date = '2099-12-31';
  assert.strictEqual(wasPostedToday(guildId, date), false);
  markPostedToday(guildId, date);
  assert.strictEqual(wasPostedToday(guildId, date), true);
  assert.strictEqual(shouldAttemptPost(guildId, date, 12, 0), false);
  console.log('  ok dedup (wasPostedToday / markPostedToday)');
}

function testBuildMessage() {
  const msg = buildDailyRolesMessage([
    { id: '111' },
    { id: '222' },
    { id: '333' },
  ]);
  assert.ok(msg.includes('<@111>'));
  assert.ok(msg.includes('Labas Rytas!'));
  assert.ok(msg.includes('Dienos anekdotą skelia'));
  assert.ok(msg.includes('Dienos dainą pristato'));
  assert.ok(msg.includes('Dienos klausimą užduoda'));
  console.log('  ok buildDailyRolesMessage');
}

function testVilniusParts() {
  const p = getVilniusParts(new Date('2026-01-15T04:30:00.000Z'));
  assert.ok(Number.isFinite(p.hour));
  assert.ok(Number.isFinite(p.minute));
  console.log('  ok getVilniusParts:', p);
}

console.log('[test-daily-roles]');
testDateString();
testVilniusParts();
testShouldAttemptPost();
testPinnedMessageId();
testDedup();
testPickThree();
testBuildMessage();
console.log('[test-daily-roles] visi testai praeiti');
