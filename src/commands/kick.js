const path = require('path');
const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { isStaff } = require('../utils/permissions');
const { removeXp } = require('../services/levels');

const KICK_IMAGE_PATH = path.join(__dirname, '..', 'assets', 'kick.webp');
const KICK_XP_PENALTY = 5000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Atsakyti į žinutę su kick paveikslėliu ir išmesti autorių iš serverio')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addStringOption(opt =>
      opt
        .setName('messageid')
        .setDescription('Žinutės ID (dešiniu ant žinutės → Copy Message ID)')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: 'Nepakanka teisių.', ephemeral: true });
    }

    const messageId = interaction.options.getString('messageid', true).trim();
    if (!/^\d{17,20}$/.test(messageId)) {
      return interaction.reply({ content: 'Neteisingas žinutės ID formatas.', ephemeral: true });
    }

    const targetMessage = await interaction.channel.messages.fetch(messageId).catch(() => null);
    if (!targetMessage) {
      return interaction.reply({
        content: 'Žinutė nerasta šiame kanale. Patikrink ID ir kad komandą naudoji tame pačiame kanale.',
        ephemeral: true,
      });
    }

    if (targetMessage.author.bot) {
      return interaction.reply({ content: 'Negalima kick\'inti boto.', ephemeral: true });
    }

    if (targetMessage.author.id === interaction.user.id) {
      return interaction.reply({ content: 'Negalima kick\'inti savęs.', ephemeral: true });
    }

    const targetMember = await interaction.guild.members
      .fetch(targetMessage.author.id)
      .catch(() => null);
    if (!targetMember) {
      return interaction.reply({ content: 'Narys nerastas serveryje.', ephemeral: true });
    }

    if (!targetMember.kickable) {
      return interaction.reply({ content: 'Negaliu išmesti šio nario — rolė per aukšta.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Pirma atsakom, kad paveikslėlis pasiektų narį prieš jam išeinant.
      await targetMessage.reply({ files: [new AttachmentBuilder(KICK_IMAGE_PATH, { name: 'kick.webp' })] });
      // XP prieš kick, nes removeXp atnaujina lygio roles nariui serveryje.
      const xpOut = await removeXp(targetMember, KICK_XP_PENALTY);
      await targetMember.kick(`Kick — ${interaction.user.tag}`);

      await interaction.editReply({
        content:
          `${targetMessage.author} išmestas iš serverio už žinutę ${targetMessage.url}\n` +
          `Atimta **${KICK_XP_PENALTY.toLocaleString('lt-LT')} XP** → lygis **${xpOut.newLevel}**, XP **${xpOut.newXp.toLocaleString('lt-LT')}**.`,
      });
    } catch (err) {
      await interaction.editReply({
        content: `Nepavyko: ${err?.message || err}`,
      });
    }
  },
};
