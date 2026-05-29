const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { generateLeaderboardImage, getModeLabels } = require('../utils/leaderboardImage');
const { isStaff } = require('../utils/permissions');
const { isInviteLeaderboardPublic } = require('../services/inviteTracking');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lyderiai')
    .setDescription('Top 15 narių pagal XP arba pakvietimus (grafika)')
    .addStringOption(opt =>
      opt
        .setName('tipas')
        .setDescription('Lyderių lentelės tipas')
        .addChoices(
          { name: 'Lygis (XP)', value: 'lygis' },
          { name: 'Pakvietimai', value: 'pakvietimai' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const tipas = interaction.options.getString('tipas') ?? 'lygis';
    const mode = tipas === 'pakvietimai' ? 'invites' : 'xp';
    const labels = getModeLabels(mode);
    const hideInvites =
      mode === 'invites' &&
      !isInviteLeaderboardPublic(interaction.guild.id) &&
      !isStaff(interaction.member);

    try {
      const buffer = await generateLeaderboardImage(interaction.guild, interaction.client, {
        mode,
        forceEmpty: hideInvites,
        hiddenEmpty: hideInvites,
      });
      const attachment = new AttachmentBuilder(buffer, { name: labels.filename });
      await interaction.editReply({ files: [attachment] });
    } catch (err) {
      console.error('[lyderiai]', err);
      await interaction.editReply({ content: 'Nepavyko sugeneruoti lyderių lentelės.' });
    }
  },
};
