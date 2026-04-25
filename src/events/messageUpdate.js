const { EmbedBuilder } = require('discord.js');
const config = require('../config');

module.exports = {
  name: 'messageUpdate',
  async execute(oldMessage, newMessage) {
    if (oldMessage.partial) {
      oldMessage = await oldMessage.fetch().catch(() => null);
      if (!oldMessage) return;
    }
    if (newMessage.partial) {
      newMessage = await newMessage.fetch().catch(() => null);
      if (!newMessage) return;
    }
    if (newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return;

    const logChannel = newMessage.guild?.channels.cache.get(config.logChannelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setTitle('Žinutė redaguota')
      .setColor(0xfee75c)
      .addFields(
        { name: 'Autorius', value: `${newMessage.author.username} (<@${newMessage.author.id}>)`, inline: true },
        { name: 'Kanalas', value: `${newMessage.channel}`, inline: true },
        { name: 'Prieš', value: oldMessage.content ? `\`\`\`${oldMessage.content.slice(0, 1018)}\`\`\`` : '*(nežinoma)*' },
        { name: 'Po', value: newMessage.content ? `\`\`\`${newMessage.content.slice(0, 1018)}\`\`\`` : '*(tuščia)*' }
      )
      .setTimestamp()
      .setFooter({ text: `ID: ${newMessage.id}` });

    await logChannel.send({ embeds: [embed] });
  },
};
