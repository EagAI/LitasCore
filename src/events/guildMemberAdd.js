const { AttachmentBuilder, ActivityType } = require('discord.js');
const config = require('../config');
const { generateWelcomeImage } = require('../utils/welcomeImage');
const { restoreMemberRolesBackup } = require('../services/memberRolesBackup');
const { logGuildMemberEvent } = require('../services/userStats');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    logGuildMemberEvent(member.guild.id, member.id, 'join');
    for (const roleId of config.welcomeRoleIds) {
      try {
        await member.roles.add(roleId);
      } catch (err) {
        console.error('[welcome] Nepavyko priskirti rolės', roleId, err.message);
      }
    }

    if (config.blacklistRoleId) {
      const { isInLeaverList } = require('../services/guildLeavers');
      if (isInLeaverList(member.guild.id, member.id)) {
        try {
          await member.roles.add(config.blacklistRoleId);
        } catch (e) {
          console.error('[blacklist-role] Nepavyko priskirti:', e?.message || e);
        }
      }
    }

    const channel = member.guild.channels.cache.get(config.welcomeChannelId);
    if (channel) {
      try {
        const buffer = await generateWelcomeImage(member);
        const attachment = new AttachmentBuilder(buffer, { name: 'welcome.png' });
        await channel.send({ files: [attachment] });
      } catch (err) {
        console.error('[welcome] Image generation failed:', err?.message || err, err?.stack);
        await channel.send(`Sveiki atvykę į serverį, ${member}! 🎉`);
      }
    }

    member.client.user.setPresence({
      activities: [{ name: `Iš viso mūsų: ${member.guild.memberCount}`, type: ActivityType.Watching }],
      status: 'online',
    });

    void restoreMemberRolesBackup(member).catch(e =>
      console.error('[roles-backup] restore:', e?.message || e)
    );
  },
};
