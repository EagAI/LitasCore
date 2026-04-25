const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { isStaff } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Tiketų sistema')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(sub =>
      sub.setName('panel').setDescription('Išsiųsti tiketų skydelį šiame kanale')
    ),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: 'Tik staff gali naudoti šią komandą.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('Pagalba')
      .setDescription(
        'Jeigu turite nusiskundimų, klausimų ar norite kažką mums pranešti, susisiekite su Litas hub komanda paspausdami **„Atidaryti ticket"**.'
      )
      .setColor(0x5865f2);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_open')
        .setLabel('Atidaryti ticket')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📩')
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: 'Tiketų skydelis išsiųstas.', ephemeral: true });
  },
};
