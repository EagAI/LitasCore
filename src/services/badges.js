const db = require('../db');

function addBadge(userId, guildId, badgeId, addedBy) {
  const existing = db
    .prepare('SELECT 1 FROM user_badges WHERE user_id=? AND guild_id=? AND badge_id=?')
    .get(userId, guildId, badgeId);
  if (existing) return false;

  db.prepare(
    'INSERT INTO user_badges (user_id, guild_id, badge_id, added_at, added_by) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, guildId, badgeId, Date.now(), addedBy);
  return true;
}

function removeBadge(userId, guildId, badgeId) {
  const result = db
    .prepare('DELETE FROM user_badges WHERE user_id=? AND guild_id=? AND badge_id=?')
    .run(userId, guildId, badgeId);
  return result.changes > 0;
}

function getUserBadges(userId, guildId) {
  return db
    .prepare('SELECT badge_id FROM user_badges WHERE user_id=? AND guild_id=? ORDER BY added_at ASC')
    .all(userId, guildId)
    .map(r => r.badge_id);
}

module.exports = { addBadge, removeBadge, getUserBadges };
