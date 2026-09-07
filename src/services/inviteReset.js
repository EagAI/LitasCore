const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { isStaff } = require('../utils/permissions');
const { hardResetAllInvites, seedInviteCache } = require('./inviteTracking');
const config = require('../config');
const { withAllowedMentions } = require('../utils/allowedMentions');

const PREFIX = 'invreset';

async function logInviteReset(guild, actor, kind) {
  const logId = config.logChannelId;
  if (!logId || !guild) return;

  const logChannel = guild.channels.cache.get(logId)
    || await guild.client.channels.fetch(logId).catch(() => null);
  if (!logChannel?.send) return;

  const isHard = kind === 'hardreset';
  const embed = new EmbedBuilder()
    .setColor(isHard ? 0xe03030 : 0xfaa61a)
    .setTitle(isHard ? 'Pakvietimų HARDRESET' : 'Pakvietimų SOFTRESET')
    .setDescription(
      isHard
        ? 'Ištrinti visi pakvietimų duomenys (joins, stats, sekimas).'
        : 'Nuresetinta tik pakvietimų **lyderių lentelė** (userstats / milestones nepaliesti).'
    )
    .addFields({
      name: 'Padarė',
      value: `${actor} (\`${actor.tag}\`)`,
      inline: false,
    })
    .setTimestamp();

  try {
    await logChannel.send(withAllowedMentions({ embeds: [embed] }));
  } catch (err) {
    console.warn('[invreset] Nepavyko išsiųsti į log:', err?.message || err);
  }
}

function parseHardResetId(customId) {
  const parts = customId.split(':');
  if (parts.length < 4 || parts[0] !== PREFIX) return null;
  const action = parts[1];
  if (action !== 'yes' && action !== 'no') return null;
  const guildId = parts[2];
  const userId = parts[3];
  if (!guildId || !userId) return null;
  return { action, guildId, userId };
}

function buildHardResetButtons(guildId, userId, { disabled = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:yes:${guildId}:${userId}`)
      .setLabel('Taip')
      .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:no:${guildId}:${userId}`)
      .setLabel('Ne')
      .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(disabled)
  );
}

function buildHardResetConfirmReply(guildId, userId) {
  const embed = new EmbedBuilder()
    .setColor(0xe03030)
    .setDescription('**AR TIKRAI NORITE IŠTRINTI VISUS PAKVIETIMUS?**');

  return {
    embeds: [embed],
    components: [buildHardResetButtons(guildId, userId)],
    ephemeral: true,
  };
}

function buildHardResetResultEmbed(confirmed, actorTag) {
  const embed = new EmbedBuilder()
    .setColor(confirmed ? 0xe03030 : 0x57f287)
    .setDescription('**AR TIKRAI NORITE IŠTRINTI VISUS PAKVIETIMUS?**')
    .setFooter({
      text: confirmed
        ? `Ištrinta — ${actorTag}`
        : `Atšaukta — ${actorTag}`,
    });

  return embed;
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleInviteHardResetButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Neturi teisių.', ephemeral: true });
  }

  const parsed = parseHardResetId(interaction.customId);
  if (!parsed) {
    return interaction.reply({ content: 'Neteisingi duomenys.', ephemeral: true });
  }

  const { action, guildId, userId } = parsed;
  if (guildId !== interaction.guildId) {
    return interaction.reply({ content: 'Netinkama serverio kontekstas.', ephemeral: true });
  }

  if (interaction.user.id !== userId) {
    return interaction.reply({
      content: 'Tik komandą paleidęs staff gali pasirinkti.',
      ephemeral: true,
    });
  }

  const actorTag = interaction.user.tag;

  if (action === 'no') {
    return interaction.update({
      embeds: [buildHardResetResultEmbed(false, actorTag)],
      components: [buildHardResetButtons(guildId, userId, { disabled: true })],
    });
  }

  try {
    hardResetAllInvites(guildId);
    await seedInviteCache(interaction.guild);
  } catch (err) {
    console.error('[invreset]', err?.stack || err?.message || err);
    return interaction.reply({
      content: `Nepavyko ištrinti: ${String(err?.message || err).slice(0, 200)}`,
      ephemeral: true,
    });
  }

  await logInviteReset(interaction.guild, interaction.user, 'hardreset');

  return interaction.update({
    embeds: [buildHardResetResultEmbed(true, actorTag)],
    components: [buildHardResetButtons(guildId, userId, { disabled: true })],
  });
}

module.exports = {
  buildHardResetConfirmReply,
  handleInviteHardResetButton,
  parseHardResetId,
  logInviteReset,
};
