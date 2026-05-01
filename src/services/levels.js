const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../db');
const config = require('../config');
const { addBalance } = require('./economy');
const { levelRoles } = config;

const LEVELUP_IMAGE_PATH = path.join(__dirname, '../assets/levelup.png');
const LEVELUP_FILE_NAME = 'levelup.png';

function levelUpAttachmentFiles() {
  return [new AttachmentBuilder(LEVELUP_IMAGE_PATH, { name: LEVELUP_FILE_NAME })];
}

function embedSetLevelUpThumbnail(embed) {
  embed.setThumbnail(`attachment://${LEVELUP_FILE_NAME}`);
}

function getLevelUpChannel(guild) {
  const id = config.pasekimuChannelId || config.levelUpChannelId;
  return id ? guild.channels.cache.get(id) : null;
}

const BASE_XP = 100;
const MULTIPLIER = 1.3;

function xpRequiredForLevel(level) {
  let total = 0;
  for (let i = 1; i <= level; i++) {
    total += Math.floor(BASE_XP * Math.pow(MULTIPLIER, i - 1));
  }
  return total;
}

function getLevelFromXp(xp) {
  let level = 0;
  while (xpRequiredForLevel(level + 1) <= xp) {
    level++;
  }
  return level;
}

function getProgressInfo(xp) {
  const level = getLevelFromXp(xp);
  const currentFloor = xpRequiredForLevel(level);
  const nextCeiling = xpRequiredForLevel(level + 1);
  return {
    level,
    current: xp - currentFloor,
    needed: nextCeiling - currentFloor,
    percent: Math.floor(((xp - currentFloor) / (nextCeiling - currentFloor)) * 100),
  };
}

function ensureRecord(userId, guildId) {
  const row = db
    .prepare('SELECT * FROM levels WHERE user_id = ? AND guild_id = ?')
    .get(userId, guildId);
  if (!row) {
    db.prepare(
      'INSERT INTO levels (user_id, guild_id, xp, level, last_xp_time, total_messages, total_voice_minutes, voice_joined_at) VALUES (?, ?, 0, 0, 0, 0, 0, 0)'
    ).run(userId, guildId);
    return db
      .prepare('SELECT * FROM levels WHERE user_id = ? AND guild_id = ?')
      .get(userId, guildId);
  }
  return row;
}

async function addXp(member, amount) {
  const record = ensureRecord(member.id, member.guild.id);
  const newXp = record.xp + amount;
  const newLevel = getLevelFromXp(newXp);

  db.prepare(
    'UPDATE levels SET xp = ?, level = ? WHERE user_id = ? AND guild_id = ?'
  ).run(newXp, newLevel, member.id, member.guild.id);

  if (newLevel > record.level) {
    await assignLevelRoles(member, newLevel);
    const levelsGained = newLevel - record.level;
    setImmediate(() => {
      try {
        for (let i = 0; i < levelsGained; i++) {
          const amt = 10 + Math.floor(Math.random() * 6);
          addBalance(member.id, member.guild.id, amt);
        }
      } catch (_) {
        /* tyliai */
      }
    });
    const isMilestone = await postMilestoneLevelUp(member, newLevel);
    return { leveledUp: true, newLevel, newXp, isMilestone };
  }
  return { leveledUp: false, newLevel, newXp };
}

async function postMilestoneLevelUp(member, level) {
  // Rodome rolę tik kai pakilama tiksliai į etapą (5, 10, 15…), ne tarp lygių —
  // kitaip getRewardRole(level) vis dar grąžina žemesnio etapo rolę (pvz. lygis 6 → „5“ rolė).
  const milestone = levelRoles.find(r => r.level === level && r.roleId);
  if (!milestone) return false;

  const channel = getLevelUpChannel(member.guild);
  if (!channel) return false;

  const role = member.guild.roles.cache.get(milestone.roleId);
  const roleName = role ? role.name : 'Nauja rolė';

  const t = `${config.emojis.levelup} Lygis pakeltas!`;
  const embed = new EmbedBuilder()
    .setTitle(t)
    .setDescription(
      `Sveikinu! ${member}, pakilai ką tik į **${level}** lygį!\nTu tapai **@${roleName}** 🎊`
    )
    .setColor(role?.color || 0xe03030);
  embedSetLevelUpThumbnail(embed);

  await channel.send({ embeds: [embed], files: levelUpAttachmentFiles() });
  return true;
}

/** Standartinis lygio pakilimo pranešimas kanale (ne milestone – tą jau siunčia `postMilestoneLevelUp`). */
async function announceNonMilestoneLevelUp(member, newLevel) {
  const target = getLevelUpChannel(member.guild);
  if (!target) return;

  const embed = new EmbedBuilder()
    .setTitle(`${config.emojis.levelup} Lygis pakeltas!`)
    .setDescription(`Sveikinu! ${member}, pakilai ką tik į **${newLevel}** lygį!`)
    .setColor(0xe03030);
  embedSetLevelUpThumbnail(embed);

  await target.send({ embeds: [embed], files: levelUpAttachmentFiles() });
}

/** Po `addXp`: jei pakilo lygis ir ne milestone embed – išsiųsti paprastą level-up. */
async function afterXpGainAnnouncements(member, result) {
  if (!result?.leveledUp || result.isMilestone) return;
  await announceNonMilestoneLevelUp(member, result.newLevel);
}

async function removeXp(member, amount) {
  const record = ensureRecord(member.id, member.guild.id);
  const newXp = Math.max(0, record.xp - amount);
  const newLevel = getLevelFromXp(newXp);

  db.prepare(
    'UPDATE levels SET xp = ?, level = ? WHERE user_id = ? AND guild_id = ?'
  ).run(newXp, newLevel, member.id, member.guild.id);

  await assignLevelRoles(member, newLevel);
  return { newXp, newLevel, oldXp: record.xp, oldLevel: record.level };
}

function buildLevelCheckEmbed(user, guildId) {
  const record = ensureRecord(user.id, guildId);
  const xp = record?.xp || 0;
  const info = getProgressInfo(xp);
  const bar = buildProgressBar(info.percent);
  const name = user.globalName || user.username;

  return new EmbedBuilder()
    .setAuthor({ name, iconURL: user.displayAvatarURL() })
    .setColor(0x5865f2)
    .addFields(
      { name: 'Lygis', value: `${info.level}`, inline: true },
      { name: 'XP', value: `${xp}`, inline: true },
      { name: 'Progreso', value: `${info.current} / ${info.needed} XP (${info.percent}%)`, inline: true },
      { name: '\u200b', value: bar },
      { name: 'Žinutės', value: `${record?.total_messages || 0}`, inline: true },
      { name: 'Voice (min)', value: `${record?.total_voice_minutes || 0}`, inline: true }
    );
}

async function handleXp(message) {
  if (message.content.length < 3) return;

  const now = Date.now();
  const record = ensureRecord(message.author.id, message.guild.id);

  if (now - record.last_xp_time < config.xpCooldownMs) return;

  db.prepare(
    'UPDATE levels SET last_xp_time = ?, total_messages = total_messages + 1 WHERE user_id = ? AND guild_id = ?'
  ).run(now, message.author.id, message.guild.id);

  const result = await addXp(message.member, config.xpPerMessage);
  await afterXpGainAnnouncements(message.member, result);
}

function trackVoiceJoin(userId, guildId) {
  ensureRecord(userId, guildId);
  db.prepare(
    'UPDATE levels SET voice_joined_at = ? WHERE user_id = ? AND guild_id = ?'
  ).run(Date.now(), userId, guildId);
}

async function trackVoiceLeave(member) {
  const record = db
    .prepare('SELECT * FROM levels WHERE user_id = ? AND guild_id = ?')
    .get(member.id, member.guild.id);
  if (!record || !record.voice_joined_at) return;

  const ms = Date.now() - record.voice_joined_at;
  // Apvalinimas (ne floor): kitaip < 1 min. sesijos visada 0, nors narys kalbėdavo
  const minutes = Math.round(ms / 60000);
  if (minutes <= 0) {
    db.prepare(
      'UPDATE levels SET voice_joined_at = 0 WHERE user_id = ? AND guild_id = ?'
    ).run(member.id, member.guild.id);
    return;
  }

  db.prepare(
    'UPDATE levels SET voice_joined_at = 0, total_voice_minutes = total_voice_minutes + ? WHERE user_id = ? AND guild_id = ?'
  ).run(minutes, member.id, member.guild.id);

  const xpGained = minutes * config.voiceXpPerMinute;
  const result = await addXp(member, xpGained);
  await afterXpGainAnnouncements(member, result);
}

function getRewardRole(level) {
  const sorted = [...levelRoles].sort((a, b) => b.level - a.level);
  return sorted.find(r => r.roleId && level >= r.level) || null;
}

async function assignLevelRoles(member, level) {
  if (config.levelRolesStack) {
    for (const { level: need, roleId } of levelRoles) {
      if (!roleId) continue;
      if (level >= need) {
        if (!member.roles.cache.has(roleId)) {
          await member.roles.add(roleId).catch(() => {});
        }
      } else if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId).catch(() => {});
      }
    }
    return;
  }

  const allRoleIds = levelRoles.map(r => r.roleId).filter(Boolean);
  const reward = getRewardRole(level);

  for (const roleId of allRoleIds) {
    if (reward && roleId === reward.roleId) {
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId).catch(() => {});
      }
    } else {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId).catch(() => {});
      }
    }
  }
}

async function buildRankEmbed(member) {
  const record = db
    .prepare('SELECT * FROM levels WHERE user_id = ? AND guild_id = ?')
    .get(member.id, member.guild.id);

  const xp = record?.xp || 0;
  const info = getProgressInfo(xp);

  const bar = buildProgressBar(info.percent);

  return new EmbedBuilder()
    .setAuthor({ name: member.displayName, iconURL: member.user.displayAvatarURL() })
    .setColor(0x5865f2)
    .addFields(
      { name: 'Lygis', value: `${info.level}`, inline: true },
      { name: 'XP', value: `${xp}`, inline: true },
      { name: 'Progreso', value: `${info.current} / ${info.needed} XP (${info.percent}%)`, inline: true },
      { name: '\u200b', value: bar },
      { name: 'Žinutės', value: `${record?.total_messages || 0}`, inline: true },
      { name: 'Voice (min)', value: `${record?.total_voice_minutes || 0}`, inline: true }
    );
}

function buildProgressBar(percent) {
  const filled = Math.round(percent / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${percent}%`;
}

/** Bandomasis lygio embed (staff /test levelup) — be DB pakeitimų. */
function getTestLevelUpPayload(member, displayLevel) {
  const embed = new EmbedBuilder()
    .setTitle(`${config.emojis.levelup} Lygis pakeltas!`)
    .setDescription(
      `Sveikinu! ${member}, pakilai ką tik į **${displayLevel}** lygį!\n` +
      '_Tai bandomasis pranešimas — XP nekeičiamas._'
    )
    .setColor(0xe03030);
  embedSetLevelUpThumbnail(embed);
  return { embeds: [embed], files: levelUpAttachmentFiles() };
}

module.exports = {
  handleXp,
  buildRankEmbed,
  buildLevelCheckEmbed,
  assignLevelRoles,
  trackVoiceJoin,
  trackVoiceLeave,
  addXp,
  removeXp,
  afterXpGainAnnouncements,
  getTestLevelUpPayload,
};
