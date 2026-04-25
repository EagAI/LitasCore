const { EmbedBuilder, AuditLogEvent } = require('discord.js');
const config = require('../config');

module.exports = {
  name: 'guildBanRemove',
  async execute(ban) {
    const logChannel = ban.guild.channels.cache.get(config.logChannelId);
    if (!logChannel) return;

    let executor = null;
    const logs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanRemove, limit: 1 }).catch(() => null);
    const entry = logs?.entries.first();
    if (entry && entry.targetId === ban.user.id) {
      executor = entry.executor ?? await ban.guild.client.users.fetch(entry.executorId).catch(() => null);
    }

    const embed = new EmbedBuilder()
      .setTitle('Narys atblokuotas (unban)')
      .setColor(0x57f287)
      .addFields(
        { name: 'Narys', value: `${ban.user.username} (<@${ban.user.id}>)`, inline: true },
        { name: 'Moderatorius', value: executor ? `${executor.username} (<@${executor.id}>)` : 'Nežinoma', inline: true }
      )
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  },
};
