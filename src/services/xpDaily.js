const db = require('../db');

const TZ = 'Europe/Vilnius';

function vilniusDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function shiftDay(dayStr, delta) {
  const [y, m, d] = String(dayStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function daysInclusive(fromDay, toDay) {
  const [y1, m1, d1] = String(fromDay).split('-').map(Number);
  const [y2, m2, d2] = String(toDay).split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function tzOffsetMs(date, timeZone = TZ) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = type => Number(parts.find(p => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return asUtc - date.getTime();
}

/** Vilniaus dienos 00:00 epoch ms. */
function vilniusStartMs(dayStr) {
  const [y, m, d] = String(dayStr).split('-').map(Number);
  const asUtcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0);
  let utc = asUtcMidnight - tzOffsetMs(new Date(asUtcMidnight));
  utc = asUtcMidnight - tzOffsetMs(new Date(utc));
  return utc;
}

/** Inclusive calendar days → [fromMs, toMs) in Vilnius. */
function dayRangeMs(fromDay, toDay) {
  return {
    fromMs: vilniusStartMs(fromDay),
    toMs: vilniusStartMs(shiftDay(toDay, 1)),
  };
}

function countMemberEvents(guildId, kind, fromMs, toMs) {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c, COUNT(DISTINCT user_id) AS u
         FROM guild_member_events
         WHERE guild_id = ? AND kind = ? AND at_ms >= ? AND at_ms < ?`
      )
      .get(guildId, kind, fromMs, toMs);
    return { count: Number(row?.c) || 0, unique: Number(row?.u) || 0 };
  } catch (_) {
    return { count: 0, unique: 0 };
  }
}

function recordXpDaily(guildId, userId, xpDelta, levelsDelta) {
  const xp = Math.max(0, Math.trunc(Number(xpDelta) || 0));
  const levels = Math.max(0, Math.trunc(Number(levelsDelta) || 0));
  if (!guildId || !userId || (xp <= 0 && levels <= 0)) return;

  const day = vilniusDateString();
  try {
    db.prepare(
      `INSERT INTO xp_daily (guild_id, user_id, day, xp_gained, levels_gained)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id, day) DO UPDATE SET
         xp_gained = xp_gained + excluded.xp_gained,
         levels_gained = levels_gained + excluded.levels_gained`
    ).run(guildId, userId, day, xp, levels);
  } catch (err) {
    console.error('[xpDaily] record:', err?.message || err);
  }
}

function emptyTotals() {
  return { xp: 0, levels: 0, users: 0, user_days: 0 };
}

function periodTotals(guildId, fromDay, toDay) {
  try {
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(xp_gained), 0) AS xp,
           COALESCE(SUM(levels_gained), 0) AS levels,
           COUNT(DISTINCT user_id) AS users,
           COUNT(*) AS user_days
         FROM xp_daily
         WHERE guild_id = ? AND day >= ? AND day <= ?`
      )
      .get(guildId, fromDay, toDay);
    return {
      xp: Number(row?.xp) || 0,
      levels: Number(row?.levels) || 0,
      users: Number(row?.users) || 0,
      user_days: Number(row?.user_days) || 0,
    };
  } catch (_) {
    return emptyTotals();
  }
}

function userPeriodTotals(guildId, userId, fromDay, toDay) {
  try {
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(xp_gained), 0) AS xp,
           COALESCE(SUM(levels_gained), 0) AS levels,
           COUNT(*) AS days_active
         FROM xp_daily
         WHERE guild_id = ? AND user_id = ? AND day >= ? AND day <= ?`
      )
      .get(guildId, userId, fromDay, toDay);
    return {
      xp: Number(row?.xp) || 0,
      levels: Number(row?.levels) || 0,
      days_active: Number(row?.days_active) || 0,
    };
  } catch (_) {
    return { xp: 0, levels: 0, days_active: 0 };
  }
}

function countMembersWithLevels(guildId) {
  try {
    return (
      db.prepare('SELECT COUNT(*) AS c FROM levels WHERE guild_id = ?').get(guildId)?.c ?? 0
    );
  } catch (_) {
    return 0;
  }
}

function trackingSinceDay(guildId) {
  try {
    return db.prepare('SELECT MIN(day) AS d FROM xp_daily WHERE guild_id = ?').get(guildId)?.d || null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  vilniusDateString,
  shiftDay,
  daysInclusive,
  dayRangeMs,
  recordXpDaily,
  periodTotals,
  userPeriodTotals,
  countMembersWithLevels,
  trackingSinceDay,
  countMemberEvents,
  emptyTotals,
};
