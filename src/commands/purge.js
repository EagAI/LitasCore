const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { isStaff } = require('../utils/permissions');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Ištrinti žinutes kanale')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(opt =>
      opt
        .setName('kiekis')
        .setDescription('Kiek žinučių ištrinti (1–100). Nenurodyus – ištrina viską.')
        .setMinValue(1)
        .setMaxValue(100)
    ),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: 'Nepakanka teisių.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const amount = interaction.options.getInteger('kiekis');
    let totalMsgs  = 0;
    let totalImages = 0;

    function countImages(collection) {
      let n = 0;
      for (const msg of collection.values()) {
        if (msg.attachments.some(a => a.contentType?.startsWith('image/'))) n++;
      }
      return n;
    }

    if (amount) {
      const deleted = await interaction.channel.bulkDelete(amount, true);
      totalMsgs   = deleted.size;
      totalImages = countImages(deleted);
    } else {
      let fetched;
      do {
        fetched = await interaction.channel.messages.fetch({ limit: 100 });
        const deletable = fetched.filter(
          m => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000
        );
        if (deletable.size === 0) break;
        const result = await interaction.channel.bulkDelete(deletable, true);
        totalMsgs   += result.size;
        totalImages += countImages(result);
      } while (fetched.size >= 2);
    }

    await interaction.editReply({ content: `Ištrinta ${totalMsgs} žinutė(-s).` });

    const logChannel = interaction.guild.channels.cache.get(config.logChannelId);
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor(0xe03030)
        .setDescription(
          `**Panaudojo:** ${interaction.user} (${interaction.user.tag})\n` +
          `**Kanalas:** ${interaction.channel}\n\n` +
          `Buvo ištrinta **${totalMsgs}** žinutė(-s) ir **${totalImages}** nuotrauka(-os).`
        )
        .setTimestamp();
      await logChannel.send({ embeds: [embed] });
    }
  },
};
