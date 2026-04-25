const { ChannelType, PermissionFlagsBits } = require('discord.js');
const db = require('../db');
const config = require('../config');

function getStoredHubId(guildId) {
  const row = db
    .prepare('SELECT value FROM bot_config WHERE key = ?')
    .get(`voice_hub_${guildId}`);
  return row?.value || null;
}

function storeHubId(guildId, channelId) {
  db.prepare('INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)').run(
    `voice_hub_${guildId}`,
    channelId
  );
}

async function ensureVoiceHub(client) {
  for (const [, guild] of client.guilds.cache) {
    const storedId = getStoredHubId(guild.id);

    if (storedId) {
      const existing = guild.channels.cache.get(storedId)
        || await guild.channels.fetch(storedId).catch(() => null);
      if (existing) continue;
    }

    const hub = await guild.channels.create({
      name: '➕ Sukurti kanalą',
      type: ChannelType.GuildVoice,
      parent: config.voiceCategoryId || null,
      permissionOverwrites: [
        {
          id: guild.id,
          allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel],
        },
      ],
    });

    storeHubId(guild.id, hub.id);
  }
}

function getHubChannelId(guildId) {
  return getStoredHubId(guildId);
}

module.exports = { ensureVoiceHub, getHubChannelId };
