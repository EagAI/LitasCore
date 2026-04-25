const { EmbedBuilder, AuditLogEvent } = require('discord.js');
const config = require('../config');

module.exports = {
  name: 'guildBanAdd',
  async execute(ban) {
    const logChannel = ban.guild.channels.cache.get(config.logChannelId);
    if (!logChannel) return;

    let executor = null;
    const logs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 }).catch(() => null);
    const entry = logs?.entries.first();
    if (entry && entry.targetId === ban.user.id) {
      executor = entry.executor ?? await ban.guild.client.users.fetch(entry.executorId).catch(() => null);
    }

    const embed = new EmbedBuilder()
      .setTitle('Narys užblokuotas (ban)')
      .setColor(0xed4245)
      .addFields(
        { name: 'Narys', value: `${ban.user.username} (<@${ban.user.id}>)`, inline: true },
        { name: 'Moderatorius', value: executor ? `${executor.username} (<@${executor.id}>)` : 'Nežinoma', inline: true },
        { name: 'Priežastis', value: ban.reason || entry?.reason || 'Nenurodyta' }
      )
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  },
};
