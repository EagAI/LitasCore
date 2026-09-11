const { EmbedBuilder, AuditLogEvent } = require('discord.js');
const config = require('../config');
const { withAllowedMentions } = require('../utils/allowedMentions');
const { logModEvent } = require('../services/modHistory');

module.exports = {
  name: 'guildBanAdd',
  async execute(ban) {
    let executor = null;
    const logs = await ban.guild
      .fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 })
      .catch(() => null);
    const entry = logs?.entries.first();
    if (entry && entry.targetId === ban.user.id) {
      executor = entry.executor ?? (await ban.guild.client.users.fetch(entry.executorId).catch(() => null));
    }

    logModEvent({
      guildId: ban.guild.id,
      userId: ban.user.id,
      moderatorId: executor?.id || entry?.executorId || null,
      kind: 'ban',
      reason: ban.reason || entry?.reason || null,
    });

    const logChannel = ban.guild.channels.cache.get(config.logChannelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setTitle('Narys užblokuotas (ban)')
      .setColor(0xed4245)
      .addFields(
        { name: 'Narys', value: `${ban.user.username} (<@${ban.user.id}>)`, inline: true },
        { name: 'Moderatorius', value: executor ? `${executor.username} (<@${executor.id}>)` : 'Nežinoma', inline: true },
        { name: 'Priežastis', value: ban.reason || entry?.reason || 'Nenurodyta' }
      )
      .setTimestamp();

    await logChannel.send(withAllowedMentions({ embeds: [embed] }));
  },
};
