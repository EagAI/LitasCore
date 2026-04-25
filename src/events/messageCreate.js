const { handleXp } = require('../services/levels');
const { handleAntiPing } = require('../services/antiPing');
const { handleAntiScam } = require('../services/ocr');
const { handleIdeasChannel } = require('../services/ideas');
const config = require('../config');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot) return;
    if (!message.guild) return;

    if (config.ideasChannelId && message.channel.id === config.ideasChannelId) {
      return handleIdeasChannel(message);
    }

    await handleXp(message);
    await handleAntiPing(message);

    if (message.attachments.size > 0) {
      await handleAntiScam(message);
    }
  },
};
