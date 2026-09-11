const { AttachmentBuilder } = require('discord.js');
const db = require('../db');
const { withAllowedMentions } = require('../utils/allowedMentions');

const HITCAR_VIDEO_URL =
  'https://static.klipy.com/ii/4e7bea9f7a3371424e6c16ebc93252fe/46/e6/i5UMltPyHNAYi.mp4';
const TIMEOUT_MS = 5 * 60 * 1000;
const BAN_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const HIT_TEXT = 'Buvai nutrenktas.';
const BAN_TEXT = 'tu nukraujavai ir gavai baną 1 savaitei.';

const timers = new Map();

function scheduleJob(client, jobId, executeAt) {
  clearTimeout(timers.get(jobId));
  const delay = Math.max(0, executeAt - Date.now());
  const timer = setTimeout(() => {
    runJob(client, jobId).catch(err => {
      console.error('[hitcar] job klaida:', err?.stack || err?.message || err);
    });
  }, delay);
  timers.set(jobId, timer);
}

function insertJob({ guildId, channelId, messageId, userId, actorId, reason, action, executeAt }) {
  const info = db
    .prepare(
      `INSERT INTO hitcar_jobs
       (guild_id, channel_id, message_id, user_id, actor_id, reason, action, execute_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(guildId, channelId, messageId, userId, actorId, reason, action, executeAt);
  return Number(info.lastInsertRowid);
}

function markDone(jobId) {
  db.prepare('UPDATE hitcar_jobs SET done = 1 WHERE id = ?').run(jobId);
}

async function buildHitReplyPayload() {
  try {
    const res = await fetch(HITCAR_VIDEO_URL, {
      signal: AbortSignal.timeout(20000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      content: HIT_TEXT,
      files: [new AttachmentBuilder(buf, { name: 'hitcar.mp4' })],
    };
  } catch (err) {
    console.warn('[hitcar] Nepavyko prisegti video, siunčiama nuoroda:', err?.message || err);
    return { content: `${HIT_TEXT}\n${HITCAR_VIDEO_URL}` };
  }
}

function banReason(reason, actorTag) {
  const prefix = `/hitcar — ${actorTag}`;
  const body = String(reason || '').trim() || 'nenurodyta';
  const full = `${body} (${prefix})`;
  return full.length > 512 ? `${full.slice(0, 509)}...` : full;
}

async function runBanJob(client, job) {
  const guild = client.guilds.cache.get(job.guild_id)
    || await client.guilds.fetch(job.guild_id).catch(() => null);
  if (!guild) {
    console.warn('[hitcar] Gildija nerasta banui:', job.guild_id);
    return;
  }

  const channel = guild.channels.cache.get(job.channel_id)
    || await guild.channels.fetch(job.channel_id).catch(() => null);

  if (channel?.isTextBased?.()) {
    const content = `<@${job.user_id}>, ${BAN_TEXT}`;
    const targetMessage = await channel.messages.fetch(job.message_id).catch(() => null);
    const payload = withAllowedMentions({ content }, { pingUsers: true });
    try {
      if (targetMessage) await targetMessage.reply(payload);
      else await channel.send(payload);
    } catch (err) {
      console.warn('[hitcar] Nepavyko išsiųsti ban žinutės:', err?.message || err);
    }
  }

  const actor = await client.users.fetch(job.actor_id).catch(() => null);
  const reason = banReason(job.reason, actor?.tag || job.actor_id);

  try {
    const member = await guild.members.fetch(job.user_id).catch(() => null);
    if (member) {
      if (!member.bannable) {
        console.warn(`[hitcar] Negalima užbaninti ${job.user_id} — rolė per aukšta.`);
        return;
      }
      await member.ban({ reason });
    } else {
      await guild.bans.create(job.user_id, { reason });
    }
  } catch (err) {
    console.error('[hitcar] Banas nepavyko:', err?.message || err);
    return;
  }

  const unbanId = insertJob({
    guildId: job.guild_id,
    channelId: job.channel_id,
    messageId: job.message_id,
    userId: job.user_id,
    actorId: job.actor_id,
    reason: job.reason,
    action: 'unban',
    executeAt: Date.now() + BAN_DURATION_MS,
  });
  scheduleJob(client, unbanId, Date.now() + BAN_DURATION_MS);
}

async function runUnbanJob(client, job) {
  const guild = client.guilds.cache.get(job.guild_id)
    || await client.guilds.fetch(job.guild_id).catch(() => null);
  if (!guild) {
    console.warn('[hitcar] Gildija nerasta unbanui:', job.guild_id);
    return;
  }

  try {
    await guild.bans.remove(job.user_id, 'Hitcar 1 savaitės banas baigėsi');
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/Unknown Ban/i.test(msg)) {
      console.warn('[hitcar] Unbanas nepavyko:', msg);
    }
  }
}

async function runJob(client, jobId) {
  timers.delete(jobId);
  const job = db.prepare('SELECT * FROM hitcar_jobs WHERE id = ?').get(jobId);
  if (!job || job.done) return;

  markDone(jobId);

  if (job.action === 'ban') await runBanJob(client, job);
  else if (job.action === 'unban') await runUnbanJob(client, job);
}

function scheduleHitcarBan(client, payload) {
  const executeAt = Date.now() + TIMEOUT_MS;
  const jobId = insertJob({
    ...payload,
    action: 'ban',
    executeAt,
  });
  scheduleJob(client, jobId, executeAt);
  return jobId;
}

function restoreHitcarJobs(client) {
  const pending = db.prepare('SELECT * FROM hitcar_jobs WHERE done = 0').all();
  for (const job of pending) {
    scheduleJob(client, job.id, job.execute_at);
  }
  if (pending.length) {
    console.log(`[hitcar] Atkurta ${pending.length} laukiančių veiksmų.`);
  }
}

module.exports = {
  HITCAR_VIDEO_URL,
  TIMEOUT_MS,
  BAN_DURATION_MS,
  HIT_TEXT,
  BAN_TEXT,
  buildHitReplyPayload,
  scheduleHitcarBan,
  restoreHitcarJobs,
};
