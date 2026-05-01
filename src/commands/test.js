const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { isStaff } = require('../utils/permissions');
const { getTestLevelUpPayload } = require('../services/levels');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('test')
    .setDescription('Staff: bandomieji pranešimai')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(sub =>
      sub
        .setName('levelup')
        .setDescription('Peržiūrėti lygio pakilimo embed (be XP pakeitimų)')
        .addIntegerOption(o =>
          o
            .setName('lygis')
            .setDescription('Rodomas lygis pranešime')
            .setMinValue(1)
            .setMaxValue(999)
        )
    ),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: 'Tik staff.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'levelup') {
      const level = interaction.options.getInteger('lygis') ?? 10;
      await interaction.deferReply({ ephemeral: true });
      return interaction.editReply(getTestLevelUpPayload(interaction.member, level));
    }
  },
};
