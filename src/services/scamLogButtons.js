const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { isStaff } = require('../utils/permissions');

const PREFIX = 'scam:';

function parseScamLogId(customId) {
  const parts = customId.split(':');
  if (parts.length < 4 || parts[0] !== 'scam') return null;
  const action = parts[1];
  const guildId = parts[2];
  const userId = parts[3];
  if (action !== 'ban' && action !== 'untimeout') return null;
  return { action, guildId, userId };
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleScamLogButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Neturi teisių.', ephemeral: true });
  }

  const parsed = parseScamLogId(interaction.customId);
  if (!parsed) {
    return interaction.reply({ content: 'Neteisingi duomenys.', ephemeral: true });
  }

  const { action, userId, guildId } = parsed;
  if (guildId !== interaction.guildId) {
    return interaction.reply({ content: 'Netinkama serverio kontekstas.', ephemeral: true });
  }

  if (action === 'ban') {
    try {
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (member) {
        await member.ban({ reason: `Sukčiavimo log: ${interaction.user.tag}` });
      } else {
        await interaction.guild.bans.create(userId, { reason: `Sukčiavimo log: ${interaction.user.tag}` });
      }
    } catch (e) {
      return interaction.reply({ content: `Nepavyko užbaninti: ${e?.message || e}`, ephemeral: true });
    }
  }

  if (action === 'untimeout') {
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) {
      return interaction.reply({ content: 'Narys nerastas (gal paliko serverį).', ephemeral: true });
    }
    try {
      await member.timeout(null, `Timeout nuimtas: ${interaction.user.tag}`);
    } catch (e) {
      return interaction.reply({ content: `Nepavyko nuimti timeout: ${e?.message || e}`, ephemeral: true });
    }
  }

  const statusLabel = action === 'ban' ? 'Užbaninta' : 'Timeout nuimtas';
  const doneRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('scam:done:0')
      .setLabel(`${statusLabel} — ${interaction.user.tag}`.slice(0, 80))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  try {
    await interaction.update({ components: [doneRow] });
  } catch {
    await interaction.message.edit({ components: [doneRow] }).catch(() => {});
  }
}

function buildScamLogRow(guildId, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}ban:${guildId}:${userId}`)
      .setLabel('Užbaninti')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔨'),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}untimeout:${guildId}:${userId}`)
      .setLabel('Nuimti timeout')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔓')
  );
}

module.exports = { handleScamLogButton, buildScamLogRow, parseScamLogId };
