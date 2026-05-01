const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { generateLeaderboardImage } = require('../utils/leaderboardImage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lyderiai')
    .setDescription('Top 15 narių pagal XP (grafika)'),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const buffer = await generateLeaderboardImage(interaction.guild, interaction.client);
      const attachment = new AttachmentBuilder(buffer, { name: 'lyderiai.png' });
      await interaction.editReply({ files: [attachment] });
    } catch (err) {
      console.error('[lyderiai]', err);
      await interaction.editReply({ content: 'Nepavyko sugeneruoti lyderių lentelės.' });
    }
  },
};
