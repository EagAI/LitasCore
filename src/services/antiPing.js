const db = require('../db');
const config = require('../config');

function mentionsStaff(message) {
  if (message.mentions.everyone) return true;
  const watchIds = [...config.modRoleIds, ...config.staffRoleIds];
  return watchIds.some(id => message.mentions.roles.has(id));
}

async function handleAntiPing(message) {
  if (!mentionsStaff(message)) return;

  const { antiPingWindowMs, antiPingWarnAt, antiPingTimeoutAt, antiPingTimeoutMs } = config;
  const now = Date.now();
  const uid = message.author.id;
  const gid = message.guild.id;

  let row = db.prepare('SELECT * FROM anti_ping WHERE user_id = ? AND guild_id = ?').get(uid, gid);

  if (!row) {
    db.prepare(
      'INSERT INTO anti_ping (user_id, guild_id, window_start, count, warned) VALUES (?, ?, ?, 1, 0)'
    ).run(uid, gid, now);
    return;
  }

  if (now - row.window_start > antiPingWindowMs) {
    db.prepare(
      'UPDATE anti_ping SET window_start = ?, count = 1, warned = 0 WHERE user_id = ? AND guild_id = ?'
    ).run(now, uid, gid);
    return;
  }

  const newCount = row.count + 1;
  db.prepare('UPDATE anti_ping SET count = ? WHERE user_id = ? AND guild_id = ?').run(
    newCount,
    uid,
    gid
  );

  if (newCount >= antiPingTimeoutAt) {
    db.prepare(
      'UPDATE anti_ping SET count = 0, warned = 0 WHERE user_id = ? AND guild_id = ?'
    ).run(uid, gid);
    try {
      const member = await message.guild.members.fetch(uid);
      await member.timeout(antiPingTimeoutMs, 'Per dažnas admin/mod pingimas');
      await message.channel.send(
        `${message.author} gavo timeout dėl per dažno admin/mod pingimo.`
      );
    } catch (_) {}
    return;
  }

  if (newCount >= antiPingWarnAt && !row.warned) {
    db.prepare(
      'UPDATE anti_ping SET warned = 1 WHERE user_id = ? AND guild_id = ?'
    ).run(uid, gid);
    await message.channel.send(
      `${message.author}, nepinginkite admin/mod rolių per dažnai. Tolimesni pinginiai rezultuos timeout.`
    );
  }
}

module.exports = { handleAntiPing };
