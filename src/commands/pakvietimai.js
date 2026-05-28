const { SlashCommandBuilder } = require('discord.js');
const { buildPakvietimaiEmbed } = require('../services/inviteTracking');
const { withAllowedMentions } = require('../utils/allowedMentions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pakvietimai')
    .setDescription('Parodyti kiek narių pakvietei ir sąrašą (nuo sistemos įjungimo)'),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Komanda galima tik serveryje.', ephemeral: true });
    }

    const embed = buildPakvietimaiEmbed(interaction.user, interaction.guild.id, interaction.client);
    return interaction.reply(withAllowedMentions({ embeds: [embed], ephemeral: true }));
  },
};
