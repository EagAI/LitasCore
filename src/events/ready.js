const { ActivityType } = require('discord.js');
const { startLiveStreamPoller } = require('../services/liveStreams');
const { restoreGiveawayTimers } = require('../services/giveaway');
const { ensureVoiceHub } = require('../services/voiceHub');
const { seedInviteCache } = require('../services/inviteTracking');
const config = require('../config');

function updateStatus(client) {
  const guild = client.guilds.cache.get(config.guildId);
  const count = guild?.memberCount ?? 0;
  client.user.setPresence({
    activities: [{ name: `Iš viso mūsų: ${count}`, type: ActivityType.Watching }],
    status: 'online',
  });
}

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    console.log(
      '[antiscam] Įsitikinkite, kad Developer portale įjungta „Message Content Intent“ (Bot) — kitaip priedų OCR gali neveikti.'
    );
    if ((process.env.SCAM_SCAN_ENABLED ?? 'true') !== 'false') {
      const ms = parseInt(process.env.SCAM_TIMEOUT_MS || String(86400000), 10);
      const h = Math.round(ms / 3600000);
      console.log(
        `[antiscam] Skenavimas: slenkstis ${process.env.SCAM_SCORE_THRESHOLD ?? '4'}, timeout ${h}h, pranešimai: ${config.adminActionsChannelId || 'log (įjunkite ADMIN_ACTIONS_CHANNEL_ID)'}. Bot: Moderate Members, Manage Messages, admin kanale — siųsti, priedai, embed, komponentai.`
      );
    }
    if ((process.env.INVITE_LINK_BLOCK_ENABLED ?? 'true') !== 'false') {
      console.log(
        `[invlink] Discord invite filtras įjungtas → ${config.adminActionsChannelId || 'log'}.`
      );
    }
    await ensureVoiceHub(client);
    for (const guild of client.guilds.cache.values()) {
      await seedInviteCache(guild);
    }
    startLiveStreamPoller(client);
    restoreGiveawayTimers(client);
    updateStatus(client);
    setInterval(() => updateStatus(client), 5 * 60 * 1000);
  },
};
