const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { generatePakvietimaiImage } = require('../utils/pakvietimaiImage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pakvietimai')
    .setDescription('Parodyti tavo pakvietimų statistiką (tik tau matoma)'),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Komanda galima tik serveryje.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const buffer = await generatePakvietimaiImage(
        interaction.guild,
        interaction.client,
        interaction.user.id
      );
      const attachment = new AttachmentBuilder(buffer, { name: 'pakvietimai.png' });
      await interaction.editReply({ files: [attachment] });
    } catch (err) {
      console.error('[pakvietimai]', err);
      await interaction.editReply({ content: 'Nepavyko sugeneruoti pakvietimų statistikos.' });
    }
  },
};
