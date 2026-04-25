const { EmbedBuilder, AuditLogEvent } = require('discord.js');
const config = require('../config');

const TRACKED = new Set([
  AuditLogEvent.MemberKick,
  AuditLogEvent.RoleCreate,
  AuditLogEvent.RoleDelete,
]);

const LABELS = {
  [AuditLogEvent.MemberKick]: 'Kick',
  [AuditLogEvent.RoleCreate]: 'Rolė sukurta',
  [AuditLogEvent.RoleDelete]: 'Rolė ištrinta',
};

module.exports = {
  name: 'guildAuditLogEntryCreate',
  async execute(entry, guild) {
    const logChannel = guild.channels.cache.get(config.logChannelId);
    if (!logChannel) return;

    if (entry.action === AuditLogEvent.MemberUpdate) {
      const commChange = entry.changes?.find(c => c.key === 'communication_disabled_until');
      if (!commChange) return;

      const oldUntil = commChange.old;
      const newUntil = commChange.new;
      const removed = newUntil == null && oldUntil != null;
      const applied = newUntil != null;

      let executor = entry.executor;
      if (!executor && entry.executorId) {
        executor = await guild.client.users.fetch(entry.executorId).catch(() => null);
      }
      const executorStr = executor
        ? `${executor.tag} (<@${executor.id}>)`
        : 'Nežinoma / sistema';

      let target = entry.target;
      if (!target && entry.targetId) {
        target = await guild.client.users.fetch(entry.targetId).catch(() => null);
      }
      const targetStr = target
        ? `${target.tag} (<@${target.id}>)`
        : `<@${entry.targetId}>`;

      const toTs = v => {
        if (v == null) return null;
        const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
        if (Number.isNaN(t)) return null;
        return Math.floor(t / 1000);
      };
      const fmtUntil = v => {
        const ts = toTs(v);
        if (ts == null) return '—';
        return `<t:${ts}:F> · <t:${ts}:R>`;
      };

      const embed = new EmbedBuilder()
        .setTitle(removed ? '⏱️ Timeout nuimtas' : applied ? '⏱️ Timeout nustatytas' : '⏱️ Timeout pakeistas')
        .setColor(removed ? 0x57f287 : 0xfee75c)
        .setDescription(
          removed
            ? 'Moderatorius nuėmė laikinąjį komunikacijos apribojimą (timeout).'
            : 'Nariui nustatytas arba pakeistas timeout.'
        )
        .addFields(
          { name: 'Moderatorius', value: executorStr, inline: true },
          { name: 'Narys', value: targetStr, inline: true }
        )
        .setTimestamp();

      if (removed) {
        embed.addFields({
          name: 'Ankstesnis timeout buvo iki',
          value: oldUntil == null ? '—' : fmtUntil(oldUntil),
          inline: false,
        });
      } else {
        embed.addFields({
          name: 'Negali rašyti kanaluose iki',
          value: newUntil == null ? '—' : fmtUntil(newUntil),
          inline: false,
        });
      }

      if (entry.reason) {
        embed.addFields({ name: 'Priežastis', value: entry.reason, inline: false });
      }

      await logChannel.send({ embeds: [embed] });
      return;
    }

    if (!TRACKED.has(entry.action)) return;

    let executor = entry.executor;
    if (!executor && entry.executorId) {
      executor = await guild.client.users.fetch(entry.executorId).catch(() => null);
    }

    const executorStr = executor
      ? `${executor.username} (<@${executor.id}>)`
      : 'Nežinoma';

    let target = entry.target;
    if (!target && entry.targetId) {
      target = await guild.client.users.fetch(entry.targetId).catch(() => null);
    }

    const targetStr = target
      ? target.username ?? target.name ?? target.id ?? 'Nežinoma'
      : 'Nežinoma';

    const embed = new EmbedBuilder()
      .setTitle(`Audit: ${LABELS[entry.action] ?? String(entry.action)}`)
      .setColor(0xfee75c)
      .addFields(
        { name: 'Vykdytojas', value: executorStr, inline: true },
        { name: 'Taikinys', value: targetStr, inline: true },
        { name: 'Priežastis', value: entry.reason || 'Nenurodyta' }
      )
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  },
};
