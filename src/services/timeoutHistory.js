const db = require('../db');

function parseUntilMs(value) {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function logTimeout({ guildId, userId, moderatorId, reason, durationMs, untilMs, atMs }) {
  if (!guildId || !userId) return;
  const duration = Math.max(0, Math.trunc(Number(durationMs) || 0));
  const until = untilMs == null ? null : Math.trunc(Number(untilMs));
  const at = Math.trunc(Number(atMs) || Date.now());
  const reasonText =
    typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null;

  db.prepare(
    `INSERT INTO timeout_history
      (guild_id, user_id, moderator_id, reason, duration_ms, until_ms, at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(guildId, userId, moderatorId || null, reasonText, duration, until, at);
}

/**
 * Audit log MemberUpdate — visi timeout'ai (Discord UI, botas, automatiniai).
 * Nuėmimų nerašome.
 */
function persistAppliedTimeoutFromAudit(entry, guild) {
  try {
    const commChange = entry.changes?.find(c => c.key === 'communication_disabled_until');
    if (!commChange) return;
    const untilMs = parseUntilMs(commChange.new);
    if (untilMs == null) return;
    const userId = entry.targetId;
    if (!userId) return;

    const atMs = Date.now();
    logTimeout({
      guildId: guild.id,
      userId,
      moderatorId: entry.executorId || null,
      reason: entry.reason,
      durationMs: Math.max(0, untilMs - atMs),
      untilMs,
      atMs,
    });
  } catch (err) {
    console.error('[timeoutHistory] persist:', err?.message || err);
  }
}

function countTimeouts(guildId, userId) {
  try {
    return (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM timeout_history WHERE guild_id = ? AND user_id = ?`
        )
        .get(guildId, userId)?.c ?? 0
    );
  } catch (_) {
    return 0;
  }
}

function getTimeouts(guildId, userId, { limit = 20, offset = 0 } = {}) {
  try {
    return db
      .prepare(
        `SELECT moderator_id, reason, duration_ms, until_ms, at_ms
         FROM timeout_history
         WHERE guild_id = ? AND user_id = ?
         ORDER BY at_ms DESC, id DESC
         LIMIT ? OFFSET ?`
      )
      .all(guildId, userId, limit, offset);
  } catch (_) {
    return [];
  }
}

function countTimeoutsInRange(guildId, fromMs, toMs) {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c, COUNT(DISTINCT user_id) AS u
         FROM timeout_history
         WHERE guild_id = ? AND at_ms >= ? AND at_ms < ?`
      )
      .get(guildId, fromMs, toMs);
    return { count: Number(row?.c) || 0, unique: Number(row?.u) || 0 };
  } catch (_) {
    return { count: 0, unique: 0 };
  }
}

module.exports = {
  logTimeout,
  persistAppliedTimeoutFromAudit,
  countTimeouts,
  getTimeouts,
  countTimeoutsInRange,
};
