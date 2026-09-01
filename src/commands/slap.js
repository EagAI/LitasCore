const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { isStaff } = require('../utils/permissions');

const SLAP_GIF_URL = 'https://klipy.com/gifs/slap-13622';
const SLAP_TIMEOUT_MS = 5 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slap')
    .setDescription('Atsakyti į žinutę su slap GIF ir duoti autoriui 5 min timeout')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption(opt =>
      opt
        .setName('messageid')
        .setDescription('Žinutės ID (dešiniu ant žinutės → Copy Message ID)')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: 'Nepakanka teisių.', ephemeral: true });
    }

    const messageId = interaction.options.getString('messageid', true).trim();
    if (!/^\d{17,20}$/.test(messageId)) {
      return interaction.reply({ content: 'Neteisingas žinutės ID formatas.', ephemeral: true });
    }

    const targetMessage = await interaction.channel.messages.fetch(messageId).catch(() => null);
    if (!targetMessage) {
      return interaction.reply({
        content: 'Žinutė nerasta šiame kanale. Patikrink ID ir kad komandą naudoji tame pačiame kanale.',
        ephemeral: true,
      });
    }

    if (targetMessage.author.bot) {
      return interaction.reply({ content: 'Negalima slap\'inti boto žinutės.', ephemeral: true });
    }

    if (targetMessage.author.id === interaction.user.id) {
      return interaction.reply({ content: 'Negalima slap\'inti savęs.', ephemeral: true });
    }

    const targetMember = await interaction.guild.members
      .fetch(targetMessage.author.id)
      .catch(() => null);
    if (!targetMember) {
      return interaction.reply({ content: 'Narys nerastas serveryje.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      await targetMessage.reply({ content: SLAP_GIF_URL });

      let timedOut = false;
      if (targetMember.moderatable) {
        await targetMember.timeout(SLAP_TIMEOUT_MS, `Slap — ${interaction.user.tag}`);
        timedOut = true;
      }

      const result = timedOut
        ? `${targetMessage.author} gavo slap ir **5 min** timeout už žinutę ${targetMessage.url}`
        : `${targetMessage.author} gavo slap (timeout nepritaikytas — rolė per aukšta) už žinutę ${targetMessage.url}`;

      await interaction.editReply({ content: result });
    } catch (err) {
      await interaction.editReply({
        content: `Nepavyko: ${err?.message || err}`,
      });
    }
  },
};
