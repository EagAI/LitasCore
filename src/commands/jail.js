const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { isStaff } = require('../utils/permissions');
const { jailMember } = require('../services/jail');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('jail')
    .setDescription('Pasodinti narį į kalėjimą (atskiras kanalas su klausimais)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(opt =>
      opt
        .setName('user')
        .setDescription('Narys, kurį norite pasodinti į kalėjimą')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt
        .setName('klausimai')
        .setDescription('Kiek klausimų užduoti (numatyta: 5)')
        .setMinValue(1)
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: 'Nepakanka teisių.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user', true);
    const questionCount = interaction.options.getInteger('klausimai') || 5;

    return jailMember(interaction, targetUser, questionCount);
  },
};
