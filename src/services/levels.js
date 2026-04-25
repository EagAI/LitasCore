const { EmbedBuilder } = require('discord.js');
const db = require('../db');
const config = require('../config');
const { levelRoles } = config;

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
    const isMilestone = await postMilestoneLevelUp(member, newLevel);
    return { leveledUp: true, newLevel, isMilestone };
  }
  return { leveledUp: false, newLevel };
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

  const embed = new EmbedBuilder()
    .setTitle('⬆️ Lygis pakeltas!')
    .setDescription(
      `Sveikinu! ${member}, pakilai ką tik į **${level}** lygį!\nTu tapai **@${roleName}** 🎊`
    )
    .setColor(role?.color || 0xe03030);

  await channel.send({ embeds: [embed] });
  return true;
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

  if (result.leveledUp && !result.isMilestone) {
    const target = getLevelUpChannel(message.guild);
    if (!target) return;

    const embed = new EmbedBuilder()
      .setTitle('⬆️ Lygis pakeltas!')
      .setDescription(`Sveikinu! ${message.author}, pakilai ką tik į **${result.newLevel}** lygį!`)
      .setColor(0xe03030);

    await target.send({ embeds: [embed] });
  }
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

  if (result?.leveledUp && !result.isMilestone) {
    const ch = getLevelUpChannel(member.guild);
    if (!ch) return;

    const embed = new EmbedBuilder()
      .setTitle('⬆️ Lygis pakeltas!')
      .setDescription(`Sveikinu! ${member}, pakilai ką tik į **${result.newLevel}** lygį!`)
      .setColor(0xe03030);
    await ch.send({ embeds: [embed] });
  }
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

module.exports = { handleXp, buildRankEmbed, assignLevelRoles, trackVoiceJoin, trackVoiceLeave, addXp };
