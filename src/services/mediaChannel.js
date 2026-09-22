const config = require('../config');

const WARN_TEXT = 'Čia ne diskusijų kanalas. Kelkite tik media.';
const AUTO_DELETE_MS = 5000;

function hasMedia(message) {
  if (message.attachments?.size > 0) return true;
  if (message.stickers?.size > 0) return true;
  return false;
}

/**
 * Media kanale leidžia tik failus / stickerius.
 * Tekstą ištrina, parašo įspėjimą ir po 5 s jį ištrina.
 * @returns {Promise<boolean>} true, jei tekstas ištrintas (toliau nebeapdoroti)
 */
async function handleMediaChannel(message) {
  const channelId = config.mediaChannelId;
  if (!channelId || message.channel.id !== channelId) return false;

  if (hasMedia(message)) return false;

  const warnMsg = await message
    .reply({ content: WARN_TEXT, allowedMentions: { repliedUser: false } })
    .catch(() => null);

  await message.delete().catch(() => {});

  if (warnMsg) {
    setTimeout(() => warnMsg.delete().catch(() => {}), AUTO_DELETE_MS);
  }

  return true;
}

module.exports = { handleMediaChannel };
