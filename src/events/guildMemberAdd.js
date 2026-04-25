const { AttachmentBuilder, ActivityType } = require('discord.js');
const config = require('../config');
const { generateWelcomeImage } = require('../utils/welcomeImage');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    const channel = member.guild.channels.cache.get(config.welcomeChannelId);
    if (!channel) return;

    try {
      const buffer = await generateWelcomeImage(member);
      const attachment = new AttachmentBuilder(buffer, { name: 'welcome.png' });
      await channel.send({ files: [attachment] });
    } catch (err) {
      console.error('[welcome] Image generation failed:', err.message);
      await channel.send(`Sveiki atvykę į serverį, ${member}! 🎉`);
    }

    member.client.user.setPresence({
      activities: [{ name: `Iš viso mūsų: ${member.guild.memberCount}`, type: ActivityType.Watching }],
      status: 'online',
    });
  },
};
