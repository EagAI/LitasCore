const channels = require('./config/channelIds');
const roles = require('./config/roleIds');

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,

  ...channels,
  ...roles,

  adminActionsChannelId:
    process.env.ADMIN_ACTIONS_CHANNEL_ID?.trim() || channels.adminActionsChannelId || '',

  pasekimuChannelId:
    process.env.PASEKIMU_CHANNEL_ID?.trim() || channels.pasekimuChannelId || '',

  tiktokUrl: process.env.TIKTOK_URL || '',

  youtubeChannelIds: process.env.YOUTUBE_CHANNEL_IDS
    ? process.env.YOUTUBE_CHANNEL_IDS.split(',').map(s => s.trim()).filter(Boolean)
    : [],

  antiPingWindowMs: parseInt(process.env.ANTI_PING_WINDOW_MS || '600000'),
  antiPingWarnAt: parseInt(process.env.ANTI_PING_WARN_THRESHOLD || '3'),
  antiPingTimeoutAt: parseInt(process.env.ANTI_PING_TIMEOUT_THRESHOLD || '5'),
  antiPingTimeoutMs: parseInt(process.env.ANTI_PING_TIMEOUT_DURATION_MS || '1800000'),

  xpCooldownMs: parseInt(process.env.XP_COOLDOWN_MS || '5000'),
  xpPerMessage: parseInt(process.env.XP_PER_MESSAGE || '15'),
  voiceXpPerMinute: parseInt(process.env.VOICE_XP_PER_MINUTE || '8'),
};
