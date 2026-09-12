const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { isStaff } = require('../utils/permissions');
const { unjailMember } = require('../services/jail');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unjail')
    .setDescription('Išleisti narį iš kalėjimo rankiniu būdu')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(opt =>
      opt
        .setName('user')
        .setDescription('Narys, kurį norite išleisti')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: 'Nepakanka teisių.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user', true);
    return unjailMember(interaction, targetUser);
  },
};
