const { EmbedBuilder } = require('discord.js');
const config = require('../config');

module.exports = {
  name: 'messageDelete',
  async execute(message) {
    if (message.partial) {
      message = await message.fetch().catch(() => null);
      if (!message) return;
    }
    if (message.author?.bot) return;

    const logChannel = message.guild?.channels.cache.get(config.logChannelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setTitle('Žinutė ištrinta')
      .setColor(0xed4245)
      .addFields(
        { name: 'Autorius', value: `${message.author.username} (<@${message.author.id}>)`, inline: true },
        { name: 'Kanalas', value: `${message.channel}`, inline: true },
        { name: 'Turinys', value: message.content ? `\`\`\`${message.content.slice(0, 1018)}\`\`\`` : '*(nežinoma)*' }
      )
      .setTimestamp()
      .setFooter({ text: `ID: ${message.id}` });

    await logChannel.send({ embeds: [embed] });
  },
};
