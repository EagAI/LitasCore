const { EmbedBuilder, ActivityType } = require('discord.js');
const config = require('../config');
const { saveMemberRolesBackup } = require('../services/memberRolesBackup');
const { clearRoleSnapshot } = require('../services/memberRoleSnapshot');
const { logGuildMemberEvent } = require('../services/userStats');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    clearRoleSnapshot(member.guild.id, member.id);
    saveMemberRolesBackup(member);
    logGuildMemberEvent(member.guild.id, member.id, 'leave');
    const { maybeMarkLeaverAfterGiveawayLeave } = require('../services/guildLeavers');
    try {
      maybeMarkLeaverAfterGiveawayLeave(member.guild.id, member.id);
    } catch (e) {
      console.error('[guildLeavers] remove:', e?.message || e);
    }
    const logChannel = member.guild.channels.cache.get(config.logChannelId);
    if (!logChannel) return;

    const user = member.user ?? await member.guild.client.users.fetch(member.id).catch(() => null);
    if (!user) return;

    const embed = new EmbedBuilder()
      .setTitle('Narys išėjo')
      .setColor(0xfee75c)
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: 'Narys', value: `${user.username} (<@${user.id}>)`, inline: true },
        {
          name: 'Prisijungė',
          value: member.joinedTimestamp
            ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`
            : 'nežinoma',
          inline: true,
        }
      )
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });

    member.guild.client.user.setPresence({
      activities: [{ name: `Iš viso mūsų: ${member.guild.memberCount}`, type: ActivityType.Watching }],
      status: 'online',
    });
  },
};
