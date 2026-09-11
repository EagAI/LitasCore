const config = require('../config');
const { isStaff } = require('../utils/permissions');
const { withAllowedMentions } = require('../utils/allowedMentions');

const WARN_COOLDOWN_MS = 12_000;
const lastWarnAt = new Map();

const GIF_EXT_RE = /\.gif(?:\?|$)/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|mkv)(?:\?|$)/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|bmp|tiff)(?:\?|$)/i;
const GIF_HOST_RE =
  /(?:^|\/\/)(?:(?:media|www)\.)?(?:tenor\.com|giphy\.com|i\.giphy\.com|media\.tenor\.com)\b/i;

const WARN_TEXT = {
  image:
    'kol esi minuse, nuotraukų siųsti negali. Išlipk iš minuso — tada vėl galėsi.',
  gif: 'kol esi minuse, GIF siųsti negali. Išlipk iš minuso — tada vėl galėsi.',
  video:
    'kol esi minuse, vaizdo įrašų siųsti negali. Išlipk iš minuso — tada vėl galėsi.',
};

function classifyFromTypeAndName(type, name) {
  const t = String(type || '').toLowerCase();
  const n = String(name || '');
  if (t === 'image/gif' || GIF_EXT_RE.test(n) || GIF_HOST_RE.test(n)) return 'gif';
  if (t.startsWith('video/') || VIDEO_EXT_RE.test(n)) return 'video';
  if (t.startsWith('image/') || IMAGE_EXT_RE.test(n)) return 'image';
  return null;
}

function detectMediaKind(message) {
  for (const att of message.attachments.values()) {
    const kind = classifyFromTypeAndName(att.contentType, `${att.name || ''} ${att.url || ''}`);
    if (kind) return kind;
  }

  if (message.stickers?.size > 0) {
    for (const sticker of message.stickers.values()) {
      const format = sticker.format || sticker.formatType;
      const name = `${sticker.name || ''} ${sticker.url || ''}`;
      if (GIF_EXT_RE.test(name) || format === 2 || format === 'APNG' || format === 'GIF') {
        return 'gif';
      }
    }
    return 'image';
  }

  for (const embed of message.embeds ?? []) {
    const url = `${embed.url || ''} ${embed.image?.url || ''} ${embed.thumbnail?.url || ''} ${embed.video?.url || ''}`;
    if (GIF_HOST_RE.test(url) || GIF_EXT_RE.test(url)) return 'gif';
    if (embed.video || VIDEO_EXT_RE.test(url)) return 'video';
    if (embed.image || embed.thumbnail || IMAGE_EXT_RE.test(url)) return 'image';
  }

  const text = message.content || '';
  if (GIF_HOST_RE.test(text) || GIF_EXT_RE.test(text)) return 'gif';
  if (VIDEO_EXT_RE.test(text)) return 'video';
  if (IMAGE_EXT_RE.test(text)) return 'image';

  return null;
}

function hasBlockedMedia(message) {
  return detectMediaKind(message) != null;
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

  const kind = detectMediaKind(message);
  if (!kind) return false;

  await message.delete().catch(() => null);

  if (shouldWarn(message.author.id)) {
    const content = `${message.author}, ${WARN_TEXT[kind]}`;
    await message.channel
      .send(withAllowedMentions({ content }, { pingUsers: true }))
      .catch(err => {
        console.warn('[negmedia] Nepavyko įspėti:', err?.message || err);
      });
  }

  return true;
}

module.exports = { handleNegativeLevelMedia, hasBlockedMedia, detectMediaKind };
