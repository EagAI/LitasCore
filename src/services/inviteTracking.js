const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../db');
const config = require('../config');

const INVITES_IMAGE_PATH = path.join(__dirname, '../assets/invites.png');
const INVITES_FILE_NAME = 'invites.png';

const TRACKING_SINCE_KEY = 'invite_tracking_since';

function invitesAttachmentFiles() {
  return [new AttachmentBuilder(INVITES_IMAGE_PATH, { name: INVITES_FILE_NAME })];
}

function embedSetInvitesThumbnail(embed) {
  embed.setThumbnail(`attachment://${INVITES_FILE_NAME}`);
}

function getPasekimuChannel(guild) {
  const id = config.pasekimuChannelId || config.levelUpChannelId;
  return id ? guild.channels.cache.get(id) : null;
}

function ensureTrackingSince() {
  const row = db.prepare('SELECT value FROM bot_config WHERE key = ?').get(TRACKING_SINCE_KEY);
  if (row) return parseInt(row.value, 10);
  const now = Date.now();
  db.prepare('INSERT INTO bot_config (key, value) VALUES (?, ?)').run(TRACKING_SINCE_KEY, String(now));
  return now;
}

function getTrackingSince() {
  const row = db.prepare('SELECT value FROM bot_config WHERE key = ?').get(TRACKING_SINCE_KEY);
  return row ? parseInt(row.value, 10) : ensureTrackingSince();
}

async function seedInviteCache(guild) {
  ensureTrackingSince();
  try {
    const invites = await guild.invites.fetch();
    const del = db.prepare('DELETE FROM invite_cache WHERE guild_id = ?');
    const ins = db.prepare(
      'INSERT INTO invite_cache (guild_id, code, inviter_id, uses) VALUES (?, ?, ?, ?)'
    );
    del.run(guild.id);
    for (const inv of invites.values()) {
      ins.run(guild.id, inv.code, inv.inviter?.id ?? null, inv.uses ?? 0);
    }
  } catch (e) {
    console.warn('[invites] seedInviteCache:', guild.id, e?.message || e);
  }
}

async function syncInviteCache(guild) {
  await seedInviteCache(guild);
}

function getCachedInvites(guildId) {
  return db.prepare('SELECT code, inviter_id, uses FROM invite_cache WHERE guild_id = ?').all(guildId);
}

async function resolveInviterOnJoin(guild) {
  const cached = getCachedInvites(guild.id);
  const cacheMap = new Map(cached.map(r => [r.code, r]));

  let fresh;
  try {
    fresh = await guild.invites.fetch();
  } catch (e) {
    console.warn('[invites] resolveInviterOnJoin fetch:', e?.message || e);
    return { inviterId: null, inviteCode: null };
  }

  for (const inv of fresh.values()) {
    const prev = cacheMap.get(inv.code);
    const prevUses = prev?.uses ?? 0;
    if (inv.uses > prevUses) {
      return {
        inviterId: inv.inviter?.id ?? prev?.inviter_id ?? null,
        inviteCode: inv.code,
      };
    }
  }

  return { inviterId: null, inviteCode: null };
}

function hasPriorJoin(guildId, userId) {
  const inInvites = db
    .prepare('SELECT 1 FROM invite_joins WHERE guild_id = ? AND invitee_id = ?')
    .get(guildId, userId);
  if (inInvites) return true;

  const priorEvents = db
    .prepare(
      `SELECT COUNT(*) AS c FROM guild_member_events
       WHERE guild_id = ? AND user_id = ? AND kind = 'join'`
    )
    .get(guildId, userId);
  return (priorEvents?.c ?? 0) > 0;
}

function ensureInviteStats(guildId, userId) {
  db.prepare(
    `INSERT INTO invite_stats (guild_id, user_id, valid_count, last_milestone)
     VALUES (?, ?, 0, 0)
     ON CONFLICT (guild_id, user_id) DO NOTHING`
  ).run(guildId, userId);
}

function incrementValidCount(guildId, inviterId) {
  ensureInviteStats(guildId, inviterId);
  db.prepare(
    `UPDATE invite_stats SET valid_count = valid_count + 1
     WHERE guild_id = ? AND user_id = ?`
  ).run(guildId, inviterId);
  return db
    .prepare('SELECT valid_count, last_milestone FROM invite_stats WHERE guild_id = ? AND user_id = ?')
    .get(guildId, inviterId);
}

function recordInvalidJoin(guildId, inviteeId, inviterId, inviteCode, reason) {
  db.prepare(
    `INSERT INTO invite_joins (guild_id, invitee_id, inviter_id, invite_code, joined_at, status, invalid_reason)
     VALUES (?, ?, ?, ?, ?, 'invalid', ?)
     ON CONFLICT (guild_id, invitee_id) DO NOTHING`
  ).run(guildId, inviteeId, inviterId, inviteCode, Date.now(), reason);
}

async function announceInviteMilestone(member, count) {
  const channel = getPasekimuChannel(member.guild);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('Pakvietimų pasiekimas!')
    .setDescription(`${member} jau pakvietė **${count}** naujus narius! 🎊`)
    .setColor(0xe03030);
  embedSetInvitesThumbnail(embed);

  await channel.send(
    withAllowedMentions({ embeds: [embed], files: invitesAttachmentFiles() })
  );
}

function maybeAnnounceMilestones(guildId, inviterId, member) {
  const step = config.inviteMilestoneStep || 5;
  const stats = db
    .prepare('SELECT valid_count, last_milestone FROM invite_stats WHERE guild_id = ? AND user_id = ?')
    .get(guildId, inviterId);
  if (!stats) return;

  const { valid_count, last_milestone } = stats;
  if (valid_count < step || valid_count % step !== 0) return;
  if (valid_count <= last_milestone) return;

  db.prepare(
    'UPDATE invite_stats SET last_milestone = ? WHERE guild_id = ? AND user_id = ?'
  ).run(valid_count, guildId, inviterId);

  void announceInviteMilestone(member, valid_count).catch(e =>
    console.error('[invites] milestone announce:', e?.message || e)
  );
}

async function processMemberJoin(member) {
  if (member.user.bot) return;

  const guildId = member.guild.id;
  const userId = member.id;

  if (hasPriorJoin(guildId, userId)) {
    return;
  }

  const { inviterId, inviteCode } = await resolveInviterOnJoin(member.guild);
  await syncInviteCache(member.guild);

  if (!inviterId) {
    recordInvalidJoin(guildId, userId, null, inviteCode, 'unknown_inviter');
    return;
  }

  if (inviterId === userId) {
    recordInvalidJoin(guildId, userId, inviterId, inviteCode, 'self_invite');
    return;
  }

  const minAgeMs = (config.inviteMinAccountAgeDays || 7) * 86400000;
  const accountAge = Date.now() - member.user.createdTimestamp;
  if (accountAge < minAgeMs) {
    recordInvalidJoin(guildId, userId, inviterId, inviteCode, 'account_too_young');
    return;
  }

  db.prepare(
    `INSERT INTO invite_joins (guild_id, invitee_id, inviter_id, invite_code, joined_at, status)
     VALUES (?, ?, ?, ?, ?, 'valid')
     ON CONFLICT (guild_id, invitee_id) DO NOTHING`
  ).run(guildId, userId, inviterId, inviteCode, Date.now());

  const stats = incrementValidCount(guildId, inviterId);

  const inviterMember = await member.guild.members.fetch(inviterId).catch(() => null);
  if (inviterMember && stats) {
    maybeAnnounceMilestones(guildId, inviterId, inviterMember);
  }
}

async function processMemberLeave(member) {
  if (member.user?.bot) return;

  const guildId = member.guild.id;
  const userId = member.id;

  const row = db
    .prepare(
      `SELECT inviter_id, joined_at, status FROM invite_joins
       WHERE guild_id = ? AND invitee_id = ?`
    )
    .get(guildId, userId);

  if (!row || row.status !== 'valid' || !row.inviter_id) return;

  const quickLeaveMs = (config.inviteQuickLeaveHours || 24) * 3600000;
  const elapsed = Date.now() - row.joined_at;
  if (elapsed >= quickLeaveMs) return;

  db.prepare(
    `UPDATE invite_joins SET status = 'invalid', invalid_reason = 'quick_leave'
     WHERE guild_id = ? AND invitee_id = ?`
  ).run(guildId, userId);

  db.prepare(
    `UPDATE invite_stats SET valid_count = CASE WHEN valid_count > 0 THEN valid_count - 1 ELSE 0 END
     WHERE guild_id = ? AND user_id = ?`
  ).run(guildId, row.inviter_id);
}

function getInviteStats(userId, guildId) {
  ensureInviteStats(guildId, userId);
  const stats = db
    .prepare('SELECT valid_count, last_milestone FROM invite_stats WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId);

  const step = config.inviteMilestoneStep || 5;
  const count = stats?.valid_count ?? 0;
  const nextMilestone = Math.ceil((count + 1) / step) * step;
  const untilNext = nextMilestone - count;

  return {
    validCount: count,
    lastMilestone: stats?.last_milestone ?? 0,
    nextMilestone,
    untilNext: count % step === 0 && count > 0 ? 0 : untilNext,
    trackingSince: getTrackingSince(),
  };
}

function countValidInvites(userId, guildId) {
  const stats = db
    .prepare('SELECT valid_count FROM invite_stats WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId);
  return stats?.valid_count ?? 0;
}

function getInviteRecordForInvitee(guildId, inviteeId) {
  return db
    .prepare(
      `SELECT inviter_id, invite_code, joined_at, status, invalid_reason
       FROM invite_joins WHERE guild_id = ? AND invitee_id = ?`
    )
    .get(guildId, inviteeId);
}

function getInvitesByInviter(guildId, inviterId, { limit = 50, status = null } = {}) {
  if (status) {
    return db
      .prepare(
        `SELECT invitee_id, joined_at, status, invalid_reason
         FROM invite_joins
         WHERE guild_id = ? AND inviter_id = ? AND status = ?
         ORDER BY joined_at DESC
         LIMIT ?`
      )
      .all(guildId, inviterId, status, limit);
  }
  return db
    .prepare(
      `SELECT invitee_id, joined_at, status, invalid_reason
       FROM invite_joins
       WHERE guild_id = ? AND inviter_id = ?
       ORDER BY joined_at DESC
       LIMIT ?`
    )
    .all(guildId, inviterId, limit);
}

function countInvitesByInviter(guildId, inviterId, status = null) {
  if (status) {
    return (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM invite_joins
           WHERE guild_id = ? AND inviter_id = ? AND status = ?`
        )
        .get(guildId, inviterId, status)?.c ?? 0
    );
  }
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM invite_joins WHERE guild_id = ? AND inviter_id = ?`
      )
      .get(guildId, inviterId)?.c ?? 0
  );
}

module.exports = {
  seedInviteCache,
  syncInviteCache,
  processMemberJoin,
  processMemberLeave,
  getInviteStats,
  countValidInvites,
  getTrackingSince,
  getInviteRecordForInvitee,
  getInvitesByInviter,
  countInvitesByInviter,
};
