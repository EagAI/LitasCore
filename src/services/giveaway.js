const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { randomInt } = require('crypto');
const path = require('path');
const db = require('../db');
const config = require('../config');

const DEFAULT_IMAGE = path.join(__dirname, '../assets/giveaway.png');
const ATTACHMENT_GIVEAWAY = 'attachment://giveaway.png';

const timers = new Map();

/**
 * Iš eilutės (pvz. BBCode [img]https://...[/img]) ištraukia pirmą galiojantį http(s) URL
 * arba grąžina attachment ref priedui. Netinkama reikšmė = numatytasis paveikslas.
 */
function imageUrlForEmbed(raw) {
  if (raw == null) return ATTACHMENT_GIVEAWAY;
  const s = String(raw).trim();
  if (!s) return ATTACHMENT_GIVEAWAY;
  if (s.startsWith('attachment://')) return s;
  if (s === ATTACHMENT_GIVEAWAY) return s;

  try {
    const u = new URL(s);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
  } catch {
    // ne grynas URL
  }

  const m = s.match(/https?:\/\/[^\s\]\[<>\"']+/i);
  if (m) {
    const candidate = m[0].replace(/[),.;>]+$/g, '');
    try {
      const u2 = new URL(candidate);
      if (u2.protocol === 'https:' || u2.protocol === 'http:') return u2.href;
    } catch {
      // ignore
    }
  }
  return ATTACHMENT_GIVEAWAY;
}

/** Išsaugojimui DB: tik http(s) arba null. */
function normalizeImageUrlForStorage(raw) {
  if (raw == null || !String(raw).trim()) return null;
  const n = imageUrlForEmbed(raw);
  if (n.startsWith('http')) return n;
  return null;
}

function buildEmbed(prize, winners, endTime, entryCount, imageUrl = null, requiredRoles = []) {
  const e = config.emojis;
  const fields = [
    { name: `${e.giveawayParticipants} Dalyviai`,   value: `**${entryCount}**`,                   inline: true },
    { name: `${e.giveawayWinner} Laimėtojai`, value: `**${winners}**`,                      inline: true },
    { name: `${e.giveawayClock} Baigiasi`,   value: `<t:${Math.floor(endTime / 1000)}:R>`, inline: true },
  ];

  if (requiredRoles.length > 0) {
    fields.push({
      name: `${e.giveawayLock} Kas gali dalyvauti`,
      value: requiredRoles.map(r => `<@&${r}>`).join(' '),
      inline: false,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`${e.giveawayGift} GIVEAWAY`)
    .setDescription(`## ${prize}`)
    .setColor(0xffffff)
    .addFields(...fields)
    .setFooter({ text: 'Baigiasi' })
    .setTimestamp(endTime);

  embed.setImage(imageUrl ? imageUrlForEmbed(imageUrl) : ATTACHMENT_GIVEAWAY);
  return embed;
}

function buildFiles(imageUrl) {
  const u = imageUrlForEmbed(imageUrl);
  if (u.startsWith('http')) return [];
  return [new AttachmentBuilder(DEFAULT_IMAGE, { name: 'giveaway.png' })];
}

function pickWinners(entries, count) {
  const arr = [...entries];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}

async function createGiveaway(client, channelId, guildId, prize, winnersCount, durationMs, imageUrl = null, requiredRoles = []) {
  const endTime = Date.now() + durationMs;
  const rolesJson = JSON.stringify(requiredRoles);

  const id = db
    .prepare(
      'INSERT INTO giveaways (guild_id, channel_id, prize, winners, end_time, image_url, required_roles) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(guildId, channelId, prize, winnersCount, endTime, normalizeImageUrlForStorage(imageUrl), rolesJson).lastInsertRowid;

  const embed = buildEmbed(prize, winnersCount, endTime, 0, imageUrl, requiredRoles);
  const button = new ButtonBuilder()
    .setLabel('Dalyvauti')
    .setStyle(ButtonStyle.Primary)
    .setCustomId(`giveaway_enter_${id}`)
    .setEmoji(config.giveawayButtonEmoji);
  const row = new ActionRowBuilder().addComponents(button);

  const channel = client.channels.cache.get(channelId);
  if (!channel) return id;

  const EVERYONE_ID = guildId;
  const pingableRoles = requiredRoles.filter(r => r !== EVERYONE_ID);
  const rolePing = pingableRoles.length
    ? pingableRoles.map(r => `<@&${r}>`).join(' ')
    : null;

  const msg = await channel.send({
    content: rolePing,
    embeds: [embed],
    components: [row],
    files: buildFiles(imageUrl),
  });
  db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(msg.id, id);

  scheduleEnd(client, id, endTime);
  return id;
}

function scheduleEnd(client, id, endTime) {
  const delay = endTime - Date.now();
  const timer = setTimeout(() => endGiveaway(client, id), delay > 0 ? delay : 0);
  timers.set(id, timer);
}

async function endGiveaway(client, id) {
  clearTimeout(timers.get(id));
  timers.delete(id);

  const giveaway = db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id);
  if (!giveaway || giveaway.ended) return;

  db.prepare('UPDATE giveaways SET ended = 1 WHERE id = ?').run(id);

  const entries = db
    .prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?')
    .all(id);

  const channel = client.channels.cache.get(giveaway.channel_id);
  if (!channel) return;

  const msg = await channel.messages.fetch(giveaway.message_id).catch(() => null);

  const totalEntries = entries.length;

  const endedRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('giveaway_ended')
      .setLabel('Giveaway baigtas')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  const endImage = imageUrlForEmbed(giveaway.image_url);

  if (entries.length === 0) {
    const e = config.emojis;
    const endEmbed = new EmbedBuilder()
      .setTitle(`${e.giveawayWinner} GIVEAWAY BAIGTAS ${e.giveawayWinner}`)
      .setDescription(`~~${giveaway.prize}~~`)
      .setColor(0xed4245)
      .addFields({ name: `${e.giveawayWinner} Laimėtojai`, value: 'Niekas nedalyvavo.' })
      .setFooter({ text: `Baigėsi • ${totalEntries} dalyvių` })
      .setImage(endImage)
      .setTimestamp();
    if (msg) await msg.edit({ embeds: [endEmbed], components: [endedRow] });
    return;
  }

  const winners = pickWinners(entries, Math.min(giveaway.winners, entries.length));
  const mentions = winners.map(w => `<@${w.user_id}>`).join('\n');

  const e = config.emojis;
  const endEmbed = new EmbedBuilder()
    .setTitle(`${e.giveawayWinner} GIVEAWAY BAIGTAS ${e.giveawayWinner}`)
    .setDescription(`~~${giveaway.prize}~~`)
    .setColor(0xed4245)
    .addFields({ name: `${e.giveawayWinner} Laimėtojai`, value: mentions })
    .setFooter({ text: `Baigėsi • ${totalEntries} dalyvių` })
    .setImage(endImage)
    .setTimestamp();

  if (msg) await msg.edit({ embeds: [endEmbed], components: [endedRow] });

  const e2 = config.emojis;
  const winEmbed = new EmbedBuilder()
    .setTitle(`${e2.giveawayWinner} Laimėtojai!`)
    .setDescription(
      `Sveikiname ${mentions.replace(/\n/g, ', ')}!\nJūs laimėjote **${giveaway.prize}** ${e2.giveawayGift}`
    )
    .setColor(0xed4245);

  await channel.send({ embeds: [winEmbed] });
}

async function rerollGiveaway(client, id) {
  const giveaway = db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id);
  if (!giveaway || !giveaway.ended) return;

  const entries = db
    .prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?')
    .all(id);
  if (entries.length === 0) return;

  const winners = pickWinners(entries, Math.min(giveaway.winners, entries.length));
  const mentions = winners.map(w => `<@${w.user_id}>`).join(', ');

  const channel = client.channels.cache.get(giveaway.channel_id);
  if (!channel) return;

  const e3 = config.emojis;
  await channel.send(`🔄 Reroll! Nauji laimėtojai: ${mentions} ${e3.giveawayWinner}`);
}

async function restoreGiveawayTimers(client) {
  const active = db.prepare('SELECT * FROM giveaways WHERE ended = 0').all();
  for (const g of active) {
    scheduleEnd(client, g.id, g.end_time);
  }
}

async function handleGiveawayEnter(interaction) {
  const id = parseInt(interaction.customId.replace('giveaway_enter_', ''));
  const giveaway = db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id);

  if (!giveaway || giveaway.ended) {
    return interaction.reply({ content: 'Šis giveaway jau baigtas.', ephemeral: true });
  }

  if (config.blacklistRoleId && interaction.member?.roles?.cache.has(config.blacklistRoleId)) {
    return interaction.reply({
      content: 'Jums neleidžiama dalyvauti šiame giveaway.',
      ephemeral: true,
    });
  }

  const requiredRoles = JSON.parse(giveaway.required_roles || '[]');
  if (requiredRoles.length > 0) {
    const memberRoles = interaction.member.roles.cache;
    const hasRole = requiredRoles.some(r => memberRoles.has(r));
    if (!hasRole) {
      const roleMentions = requiredRoles.map(r => `<@&${r}>`).join(', ');
      return interaction.reply({
        content: `❌ Norint dalyvauti, reikalinga rolė: ${roleMentions}`,
        ephemeral: true,
      });
    }
  }

  const existing = db
    .prepare('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?')
    .get(id, interaction.user.id);

  if (existing) {
    return interaction.reply({ content: 'Jau dalyvaujate šiame giveaway!', ephemeral: true });
  }

  db.prepare('INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)').run(
    id,
    interaction.user.id
  );

  const count = db
    .prepare('SELECT COUNT(*) as c FROM giveaway_entries WHERE giveaway_id = ?')
    .get(id).c;

  const parsedRoles = JSON.parse(giveaway.required_roles || '[]');
  const embed = buildEmbed(giveaway.prize, giveaway.winners, giveaway.end_time, count, giveaway.image_url, parsedRoles);
  await interaction.update({ embeds: [embed] });
}

module.exports = {
  createGiveaway,
  endGiveaway,
  rerollGiveaway,
  restoreGiveawayTimers,
  handleGiveawayEnter,
};
