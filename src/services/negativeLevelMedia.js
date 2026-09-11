const config = require('../config');
const { isStaff } = require('../utils/permissions');
const { withAllowedMentions } = require('../utils/allowedMentions');

const WARN_COOLDOWN_MS = 12_000;
const lastWarnAt = new Map();

const MEDIA_EXT_RE = /\.(gif|png|jpe?g|webp|bmp|tiff|mp4|webm|mov|m4v|mkv)(?:\?|$)/i;
const GIF_HOST_RE =
  /(?:^|\/\/)(?:(?:media|www)\.)?(?:tenor\.com|giphy\.com|i\.giphy\.com|media\.tenor\.com)\b/i;

function hasBlockedMedia(message) {
  for (const att of message.attachments.values()) {
    const type = String(att.contentType || '').toLowerCase();
    if (type.startsWith('image/') || type.startsWith('video/')) return true;
    const name = `${att.name || ''} ${att.url || ''}`;
    if (MEDIA_EXT_RE.test(name)) return true;
  }

  if (message.stickers?.size > 0) return true;

  for (const embed of message.embeds ?? []) {
    if (embed.image || embed.thumbnail || embed.video) return true;
    const url = `${embed.url || ''} ${embed.image?.url || ''} ${embed.video?.url || ''}`;
    if (MEDIA_EXT_RE.test(url) || GIF_HOST_RE.test(url)) return true;
  }

  const text = message.content || '';
  if (MEDIA_EXT_RE.test(text) || GIF_HOST_RE.test(text)) return true;

  return false;
}

function shouldWarn(userId) {
  const now = Date.now();
  const last = lastWarnAt.get(userId) || 0;
  if (now - last < WARN_COOLDOWN_MS) return false;
  lastWarnAt.set(userId, now);
  return true;
}

/**
 * Minusinio lygio nariams bendrame kanale blokuoja nuotraukas, GIF ir video.
 * @returns {Promise<boolean>} true, jei žinutė ištrinta
 */
async function handleNegativeLevelMedia(message) {
  const channelId = config.bendrasChannelId;
  const roleId = config.negativeLevelRoleId;
  if (!channelId || !roleId) return false;
  if (message.channel.id !== channelId) return false;
  if (isStaff(message.member)) return false;
  if (!message.member?.roles?.cache.has(roleId)) return false;
  if (!hasBlockedMedia(message)) return false;

  await message.delete().catch(() => null);

  if (shouldWarn(message.author.id)) {
    const content =
      `${message.author}, kol esi minuse, nuotraukų, GIF ir vaizdo įrašų siųsti negali. ` +
      `Išlipk iš minuso — tada vėl galėsi.`;
    await message.channel
      .send(withAllowedMentions({ content }, { pingUsers: true }))
      .catch(err => {
        console.warn('[negmedia] Nepavyko įspėti:', err?.message || err);
      });
  }

  return true;
}

module.exports = { handleNegativeLevelMedia, hasBlockedMedia };
