const db = require('../db');

/**
 * Ar narys dalyvavo bent viename baigtame giveaway serveryje?
 * @param {string} guildId
 * @param {string} userId
 * @returns {boolean}
 */
function participatedInCompletedGiveaway(guildId, userId) {
  const row = db
    .prepare(
      `SELECT 1 AS ok
       FROM giveaway_entries ge
       INNER JOIN giveaways g ON g.id = ge.giveaway_id
       WHERE g.guild_id = ? AND g.ended = 1 AND ge.user_id = ?
       LIMIT 1`
    )
    .get(guildId, userId);
  return Boolean(row);
}

/**
 * Užfiksuoti nario išėjimą: įterpti/atnaujinti eilutę, jei jo giveaway sąlyga tenkinta.
 * @param {string} guildId
 * @param {string} userId
 * @param {string|null} reason
 * @returns {boolean} ar įrašas pakeistas
 */
function markLeaver(guildId, userId, reason = null) {
  const at = Date.now();
  const r = db
    .prepare(
      `INSERT INTO guild_leavers (guild_id, user_id, marked_at, reason)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET
         marked_at = excluded.marked_at,
         reason = excluded.reason`
    )
    .run(guildId, userId, at, reason);
  return r.changes > 0;
}

/**
 * Išsaugoti leaver, jei reikia po išėjimo su giveaway salyga.
 */
function maybeMarkLeaverAfterGiveawayLeave(guildId, userId) {
  if (!participatedInCompletedGiveaway(guildId, userId)) return false;
  return markLeaver(guildId, userId, 'giveaway');
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @returns {boolean}
 */
function isInLeaverList(guildId, userId) {
  const row = db
    .prepare('SELECT 1 AS ok FROM guild_leavers WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId);
  return Boolean(row);
}

/**
 * Admin: įrašas arba perrašymas
 */
function adminUpsertLeaver(guildId, userId, reason) {
  const at = Date.now();
  const r = db
    .prepare(
      `INSERT INTO guild_leavers (guild_id, user_id, marked_at, reason)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET
         marked_at = excluded.marked_at,
         reason = excluded.reason`
    )
    .run(guildId, userId, at, reason ?? null);
  return r.changes > 0;
}

/**
 * Admin: pašalinti iš sąrašo
 */
function adminRemoveLeaver(guildId, userId) {
  return db
    .prepare('DELETE FROM guild_leavers WHERE guild_id = ? AND user_id = ?')
    .run(guildId, userId);
}

module.exports = {
  participatedInCompletedGiveaway,
  markLeaver,
  maybeMarkLeaverAfterGiveawayLeave,
  isInLeaverList,
  adminUpsertLeaver,
  adminRemoveLeaver,
};
