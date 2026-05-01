const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require('discord.js');
const { XMLParser } = require('fast-xml-parser');
const db = require('../db');
const config = require('../config');

const RSS_BASE = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const INTERVAL_MS = 5 * 60 * 1000;

const THUMB_ATTACH_NAME = 'youtube-thumbnail.jpg';
const THUMB_FETCH_TIMEOUT_MS = 15_000;
const MIN_IMAGE_BYTES = 1500;
const RETRY_ROUNDS = 3;
const RETRY_DELAY_MS = 2500;

const parser = new XMLParser({ ignoreAttributes: false });

/** Neleidžia lygiagrečių `checkChannels` (lėtas RSS + persidengiantis intervalas). */
let pollInFlight = false;

/**
 * Iš YouTube RSS įrašo paima media:thumbnail URL, jei parseris juos pateikia.
 */
function extractRssThumbnailUrls(entry) {
  if (!entry || typeof entry !== 'object') return [];
  const out = [];
  const group = entry['media:group'] || entry['media$group'] || entry.group;
  if (group) {
    const raw = group['media:thumbnail'] || group['media$thumbnail'];
    const arr = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    for (const item of arr) {
      if (!item) continue;
      const u = item['@_url'] || item['@:url'] || item.url;
      if (typeof u === 'string' && u.startsWith('http') && u.includes('ytimg')) {
        out.push(u.trim());
      }
    }
  }
  return [...new Set(out)];
}

function staticThumbnailUrlCandidates(videoId) {
  const b = `https://i.ytimg.com/vi/${videoId}`;
  return [
    `${b}/maxresdefault.jpg`,
    `${b}/hqdefault.jpg`,
    `${b}/sddefault.jpg`,
    `${b}/mqdefault.jpg`,
    `${b}/default.jpg`,
    `https://img.youtube.com/vi/${videoId}/0.jpg`,
  ];
}

/**
 * Atsisiunčia pirmą veikiančią miniatiūrą. Keli raundai (naujems įrašams CDN vėluoja).
 */
async function loadThumbnailBuffer(urls) {
  const list = [...new Set(urls.filter(u => typeof u === 'string' && u.startsWith('http')))];
  if (list.length === 0) return null;

  for (let round = 0; round < RETRY_ROUNDS; round++) {
    for (const url of list) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(THUMB_FETCH_TIMEOUT_MS) });
        if (!res.ok) continue;
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct && !ct.includes('image') && !ct.includes('octet')) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length >= MIN_IMAGE_BYTES) {
          return buf;
        }
      } catch (_) {
        /* kitas URL arba raundas */
      }
    }
    if (round < RETRY_ROUNDS - 1) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  return null;
}

async function fetchLatestVideo(ytChannelId) {
  const res = await fetch(`${RSS_BASE}${ytChannelId}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;

  const xml = await res.text();
  const parsed = parser.parse(xml);
  const rawEntries = parsed?.feed?.entry;
  if (!rawEntries) return null;

  const entry = Array.isArray(rawEntries) ? rawEntries[0] : rawEntries;
  const videoId = entry['yt:videoId'] || entry.videoId;
  if (!videoId) return null;

  const titleRaw = entry.title;
  const titleStr =
    typeof titleRaw === 'string'
      ? titleRaw
      : titleRaw && typeof titleRaw === 'object' && titleRaw['#text']
        ? String(titleRaw['#text'])
        : 'Naujas video';

  const rssThumbs = extractRssThumbnailUrls(entry);

  return {
    videoId,
    title: titleStr,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    author: entry.author?.name || 'YouTube',
    published: entry.published,
    rssThumbnails: rssThumbs,
  };
}

function buildYouTubeMessagePayload(video, thumbBuffer) {
  const embed = new EmbedBuilder()
    .setTitle(video.title)
    .setURL(video.url)
    .setColor(0xff0000)
    .setImage(`attachment://${THUMB_ATTACH_NAME}`);

  const buttons = [
    new ButtonBuilder()
      .setLabel('Žiūrėti per YouTube')
      .setStyle(ButtonStyle.Link)
      .setURL(video.url)
      .setEmoji('▶️'),
  ];

  if (config.tiktokUrl) {
    buttons.push(
      new ButtonBuilder()
        .setLabel('Žiūrėti per TikTok')
        .setStyle(ButtonStyle.Link)
        .setURL(config.tiktokUrl)
        .setEmoji('🎵')
    );
  }

  const row = new ActionRowBuilder().addComponents(...buttons);
  const attachment = new AttachmentBuilder(thumbBuffer, { name: THUMB_ATTACH_NAME });

  return {
    content: `Opa @everyone, LITAS ką tik naujo kontento pakūrė❗ Pažiūrim😱`,
    embeds: [embed],
    components: [row],
    files: [attachment],
  };
}

/** Paskutinis atsarginis variantas – bet įrašyti atgal į setImage, jei atsisiuntimas visiškai nevyksta. */
function lastResortImageUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

async function checkChannels(client) {
  const ytId = config.youtubeChannelId;
  if (!ytId) return;

  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const announceChannel = client.channels.cache.get(config.youtubeAnnounceChannelId);
    if (!announceChannel) return;

    try {
      const video = await fetchLatestVideo(ytId);
      if (!video) return;

      const dbRow = db
        .prepare('SELECT last_video_id FROM youtube_state WHERE yt_channel_id = ?')
        .get(ytId);

      if (!dbRow) {
        db.prepare('INSERT INTO youtube_state (yt_channel_id, last_video_id) VALUES (?, ?)').run(
          ytId,
          video.videoId
        );
        return;
      }

      if (dbRow.last_video_id === video.videoId) return;

      const prev = dbRow.last_video_id;
      const claimed = db
        .prepare(
          `UPDATE youtube_state SET last_video_id = ?
           WHERE yt_channel_id = ? AND last_video_id = ?`
        )
        .run(video.videoId, ytId, prev);

      if (claimed.changes === 0) {
        return;
      }

      const allThumbUrls = [...(video.rssThumbnails || []), ...staticThumbnailUrlCandidates(video.videoId)];
      const thumbBuffer = await loadThumbnailBuffer(allThumbUrls);

      if (!thumbBuffer) {
        console.error(
          '[youtube] Miniatiūra neatsisiųsta po',
          RETRY_ROUNDS,
          'raundų — skelbiamas atsarginis embed URL, videoId:',
          video.videoId
        );
      }

      if (thumbBuffer) {
        await announceChannel.send(buildYouTubeMessagePayload(video, thumbBuffer));
      } else {
        const embed = new EmbedBuilder()
          .setTitle(video.title)
          .setURL(video.url)
          .setColor(0xff0000)
          .setImage(lastResortImageUrl(video.videoId));

        const buttons = [
          new ButtonBuilder()
            .setLabel('Žiūrėti per YouTube')
            .setStyle(ButtonStyle.Link)
            .setURL(video.url)
            .setEmoji('▶️'),
        ];
        if (config.tiktokUrl) {
          buttons.push(
            new ButtonBuilder()
              .setLabel('Žiūrėti per TikTok')
              .setStyle(ButtonStyle.Link)
              .setURL(config.tiktokUrl)
              .setEmoji('🎵')
          );
        }
        const row = new ActionRowBuilder().addComponents(...buttons);
        await announceChannel.send({
          content: `Opa @everyone, LITAS ką tik naujo kontento pakūrė❗ Pažiūrim😱`,
          embeds: [embed],
          components: [row],
        });
      }
    } catch (e) {
      console.error('[youtube] poll:', e?.message || e);
    }
  } finally {
    pollInFlight = false;
  }
}

function startYoutubePoller(client) {
  if (!config.youtubeChannelId) return;
  checkChannels(client);
  setInterval(() => checkChannels(client), INTERVAL_MS);
}

module.exports = { startYoutubePoller };
