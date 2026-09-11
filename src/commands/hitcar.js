const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { isStaff } = require('../utils/permissions');
const {
  TIMEOUT_MS,
  buildHitReplyPayload,
  scheduleHitcarBan,
} = require('../services/hitcar');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hitcar')
    .setDescription('Nutrenkti žinutės autorių: GIF, 5 min. timeout, po to 1 savaitės banas')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(opt =>
      opt
        .setName('messageid')
        .setDescription('Žinutės ID (dešiniu ant žinutės → Copy Message ID)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('priezastis')
        .setDescription('Bano priežastis (įrašoma į audit log)')
        .setRequired(true)
        .setMaxLength(400)
    ),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: 'Nepakanka teisių.', ephemeral: true });
    }

    const messageId = interaction.options.getString('messageid', true).trim();
    const reason = interaction.options.getString('priezastis', true).trim();

    if (!/^\d{17,20}$/.test(messageId)) {
      return interaction.reply({ content: 'Neteisingas žinutės ID formatas.', ephemeral: true });
    }
    if (!reason) {
      return interaction.reply({ content: 'Priežastis negali būti tuščia.', ephemeral: true });
    }

    const targetMessage = await interaction.channel.messages.fetch(messageId).catch(() => null);
    if (!targetMessage) {
      return interaction.reply({
        content: 'Žinutė nerasta šiame kanale. Patikrink ID ir kad komandą naudoji tame pačiame kanale.',
        ephemeral: true,
      });
    }

    if (targetMessage.author.bot) {
      return interaction.reply({ content: 'Negalima nutrenkti boto žinutės.', ephemeral: true });
    }

    if (targetMessage.author.id === interaction.user.id) {
      return interaction.reply({ content: 'Negalima nutrenkti savęs.', ephemeral: true });
    }

    const targetMember = await interaction.guild.members
      .fetch(targetMessage.author.id)
      .catch(() => null);
    if (!targetMember) {
      return interaction.reply({ content: 'Narys nerastas serveryje.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const payload = await buildHitReplyPayload();
      await targetMessage.reply(payload);

      let timedOut = false;
      if (targetMember.moderatable) {
        await targetMember.timeout(TIMEOUT_MS, `Hitcar — ${interaction.user.tag}`);
        timedOut = true;
      }

      scheduleHitcarBan(interaction.client, {
        guildId: interaction.guild.id,
        channelId: interaction.channel.id,
        messageId: targetMessage.id,
        userId: targetMessage.author.id,
        actorId: interaction.user.id,
        reason,
      });

      const timeoutNote = timedOut
        ? '**5 min.** timeout'
        : 'timeout nepritaikytas (rolė per aukšta)';

      await interaction.editReply({
        content:
          `${targetMessage.author} nutrenktas — ${timeoutNote}. ` +
          `Po 5 min. gaus **1 savaitės** baną.\n` +
          `Priežastis: \`${reason}\`\n${targetMessage.url}`,
      });
    } catch (err) {
      await interaction.editReply({
        content: `Nepavyko: ${err?.message || err}`,
      });
    }
  },
};
