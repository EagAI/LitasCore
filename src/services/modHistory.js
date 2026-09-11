const db = require('../db');

const KINDS = new Set(['ban', 'unban', 'kick']);

function logModEvent({ guildId, userId, moderatorId, kind, reason, atMs }) {
  if (!guildId || !userId || !KINDS.has(kind)) return;
  const reasonText =
    typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null;
  try {
    db.prepare(
      `INSERT INTO mod_history (guild_id, user_id, moderator_id, kind, reason, at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      guildId,
      userId,
      moderatorId || null,
      kind,
      reasonText,
      Math.trunc(Number(atMs) || Date.now())
    );
  } catch (err) {
    console.error('[modHistory] log:', err?.message || err);
  }
}

function persistKickFromAudit(entry, guild) {
  try {
    const userId = entry.targetId;
    if (!userId) return;
    logModEvent({
      guildId: guild.id,
      userId,
      moderatorId: entry.executorId || null,
      kind: 'kick',
      reason: entry.reason,
      atMs: Date.now(),
    });
  } catch (err) {
    console.error('[modHistory] kick:', err?.message || err);
  }
}

function countModInRange(guildId, kind, fromMs, toMs) {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c, COUNT(DISTINCT user_id) AS u
         FROM mod_history
         WHERE guild_id = ? AND kind = ? AND at_ms >= ? AND at_ms < ?`
      )
      .get(guildId, kind, fromMs, toMs);
    return { count: Number(row?.c) || 0, unique: Number(row?.u) || 0 };
  } catch (_) {
    return { count: 0, unique: 0 };
  }
}

module.exports = {
  logModEvent,
  persistKickFromAudit,
  countModInRange,
};
