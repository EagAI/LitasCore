const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const { isRoleBackupRestoreAddingRoles } = require('../services/memberRolesBackup');
const { diffRolesSinceSnapshot } = require('../services/memberRoleSnapshot');

module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember) {
    const boosted = !oldMember.premiumSinceTimestamp && newMember.premiumSinceTimestamp;
    if (boosted) {
      const boostChannel = newMember.guild.channels.cache.get(config.boostChannelId);
      if (boostChannel) {
        const boostCount = newMember.guild.premiumSubscriptionCount || 0;
        const embed = new EmbedBuilder()
          .setColor(0xff73fa)
          .setAuthor({
            name: `${newMember.displayName} just Boosted the server!`,
            iconURL: newMember.user.displayAvatarURL({ size: 64 }),
          })
          .setThumbnail(newMember.user.displayAvatarURL({ size: 256 }))
          .setDescription(
            `${newMember} padidino šio serverio lygį!\n🚀 Serveris dabar turi **${boostCount}** boost${boostCount === 1 ? '' : 'ų'}.`
          )
          .setTimestamp();

        await boostChannel.send({ embeds: [embed] });
      }
    }

    const logChannel = newMember.guild.channels.cache.get(config.logChannelId);
    if (!logChannel) return;

    const fields = [];

    if (oldMember.nickname !== newMember.nickname) {
      fields.push(
        { name: 'Senas slapyvardis', value: oldMember.nickname || '*(nėra)*', inline: true },
        { name: 'Naujas slapyvardis', value: newMember.nickname || '*(nėra)*', inline: true }
      );
    }

    const { added, removed } = diffRolesSinceSnapshot(newMember);

    if (added.length > 0) {
      fields.push({ name: 'Pridėtos rolės', value: added.map(r => r.toString()).join(', ') });
    }
    if (removed.length > 0) {
      fields.push({ name: 'Pašalintos rolės', value: removed.map(r => r.toString()).join(', ') });
    }

    if (fields.length === 0) return;

    const isRestoreSnap =
      added.length > 0 &&
      isRoleBackupRestoreAddingRoles(newMember.guild.id, newMember.user.id);

    const embed = new EmbedBuilder()
      .setTitle(
        isRestoreSnap ? 'Narys grįžo ir grąžinamos rolės' : 'Narys atnaujintas'
      )
      .setColor(0x5865f2)
      .addFields(
        { name: 'Narys', value: `${newMember.user.username} (<@${newMember.user.id}>)`, inline: true },
        ...fields
      )
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  },
};
