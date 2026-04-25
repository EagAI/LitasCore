const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { BADGE_MAP } = require('../config/badges');
const { getUserBadges } = require('../services/badges');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profilis')
    .setDescription('Parodyti nario profilį')
    .addUserOption(opt =>
      opt.setName('narys').setDescription('Kieno profilį rodyti (neįvedus – tavo)').setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const member = interaction.options.getMember('narys') ?? interaction.member;
    const fetchedUser = await member.user.fetch();

    const badgeIds = getUserBadges(member.id, interaction.guildId);
    const badgeStr = badgeIds.length
      ? badgeIds.map(id => BADGE_MAP[id]?.emoji).filter(Boolean).join('  ')
      : 'Nėra priskirtų ženklelių';

    const displayName = member.nickname || fetchedUser.displayName || fetchedUser.username;

    const embed = new EmbedBuilder()
      .setTitle(`${displayName} - Profilis`)
      .setThumbnail(fetchedUser.displayAvatarURL({ size: 256 }))
      .addFields({ name: 'Ženkleliai', value: badgeStr });

    await interaction.editReply({ embeds: [embed] });
  },
};
