const { ChannelType, PermissionFlagsBits } = require('discord.js');
const db = require('../db');
const config = require('../config');
const { trackVoiceJoin, trackVoiceLeave } = require('../services/levels');
const { getHubChannelId } = require('../services/voiceHub');
const { buildVoicePanel } = require('../services/voicePanel');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    const joined = !oldState.channelId && newState.channelId;
    const left = oldState.channelId && !newState.channelId;
    const switched =
      oldState.channelId &&
      newState.channelId &&
      oldState.channelId !== newState.channelId;

    // Pirmiausia skaičiuoti laiką senajame kanale, tada fiksuoti prisijungimą prie naujo —
    // kitaip perjungiant voice `voice_joined_at` perrašomas ir prarandamos minutės.
    if ((left || switched) && oldState.member && !oldState.member.user.bot) {
      await trackVoiceLeave(oldState.member);
    }
    if ((joined || switched) && newState.member && !newState.member.user.bot) {
      trackVoiceJoin(newState.member.id, newState.guild.id);
    }

    const hubChannelId = getHubChannelId(newState.guild.id);

    if (hubChannelId && newState.channelId === hubChannelId && newState.member) {
      const existing = db
        .prepare('SELECT channel_id FROM voice_channels WHERE owner_id = ? AND guild_id = ?')
        .get(newState.member.id, newState.guild.id);

      if (existing) {
        const existingCh = newState.guild.channels.cache.get(existing.channel_id);
        if (existingCh) {
          await newState.member.voice.setChannel(existingCh).catch(() => {});
          return;
        }
        db.prepare('DELETE FROM voice_channels WHERE channel_id = ?').run(existing.channel_id);
      }

      const channel = await newState.guild.channels.create({
        name: `${newState.member.displayName.slice(0, 22)} vc`,
        type: ChannelType.GuildVoice,
        parent: config.voiceCategoryId || null,
        permissionOverwrites: [
          { id: newState.guild.id, deny: [PermissionFlagsBits.Connect] },
          {
            id: newState.member.id,
            allow: [
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.MoveMembers,
            ],
          },
        ],
      });

      db.prepare(
        'INSERT INTO voice_channels (channel_id, guild_id, owner_id) VALUES (?, ?, ?)'
      ).run(channel.id, newState.guild.id, newState.member.id);

      await newState.member.voice.setChannel(channel).catch(() => {});
      await channel.send(buildVoicePanel(false)).catch(() => {});
    }

    if (oldState.channelId && oldState.channelId !== hubChannelId) {
      const record = db
        .prepare('SELECT * FROM voice_channels WHERE channel_id = ?')
        .get(oldState.channelId);

      if (record) {
        const ch = oldState.guild.channels.cache.get(oldState.channelId);
        if (ch && ch.members.size === 0) {
          await ch.delete().catch(() => {});
          db.prepare('DELETE FROM voice_channels WHERE channel_id = ?').run(oldState.channelId);
        }
      }
    }
  },
};
