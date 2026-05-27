const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { XMLParser } = require('fast-xml-parser');
const db = require('../db');
const config = require('../config');

const RSS_BASE = 'https://www.youtube.com/feeds/videos.xml?channel_id=';

const announceContent =
  'Opa @everyone, LITAS ką tik naujo kontento pakūrė❗ Pažiūrim😱';

const parser = new XMLParser({ ignoreAttributes: false });

const DEFAULT_TWITCH_URL = 'https://www.twitch.tv/litastv_';
const DEFAULT_KICK_URL = 'https://kick.com/litastv';

function normalizeAnnouncementTitle(title) {
  return String(title ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function lastResortImageUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function getKickWatchUrl() {
  if (config.kickUrl) return config.kickUrl;
  if (config.kickChannelSlug) return `https://kick.com/${config.kickChannelSlug}`;
  return DEFAULT_KICK_URL;
}

function getTwitchWatchUrl() {
  if (config.twitchUrl) return config.twitchUrl;
  if (config.twitchChannelLogin) return `https://www.twitch.tv/${config.twitchChannelLogin}`;
  return DEFAULT_TWITCH_URL;
}

function buildWatchButtons(videoUrl) {
  const buttons = [
    new ButtonBuilder()
      .setLabel('Žiūrėti per YouTube')
      .setStyle(ButtonStyle.Link)
      .setURL(videoUrl)
      .setEmoji('🔴'),
  ];

  if (config.tiktokUrl) {
    buttons.push(
      new ButtonBuilder()
        .setLabel('Žiūrėti per TikTok')
        .setStyle(ButtonStyle.Link)
        .setURL(config.tiktokUrl)
        .setEmoji('⚫')
    );
  }

  const kickUrl = getKickWatchUrl();
  if (kickUrl) {
    buttons.push(
      new ButtonBuilder()
        .setLabel('Žiūrėti per Kick')
        .setStyle(ButtonStyle.Link)
        .setURL(kickUrl)
        .setEmoji('🟢')
    );
  }

  const twitchUrl = getTwitchWatchUrl();
  if (twitchUrl) {
    buttons.push(
      new ButtonBuilder()
        .setLabel('Žiūrėti per Twitch')
        .setStyle(ButtonStyle.Link)
        .setURL(twitchUrl)
        .setEmoji('🟣')
    );
  }

  return new ActionRowBuilder().addComponents(...buttons);
}

function buildYoutubeEmbed(video) {
  return new EmbedBuilder()
    .setTitle(video.title)
    .setURL(video.url)
    .setColor(0xff0000)
    .setImage(lastResortImageUrl(video.videoId));
}

function formatYoutubePublishedForLog(published) {
  if (!published || typeof published !== 'string') return '—';
  const t = new Date(published).getTime();
  if (!Number.isFinite(t)) return published.slice(0, 160);
  return `<t:${Math.floor(t / 1000)}:F>`;
}

function buildYoutubeStaffLogEmbed(video) {
  const titleTrunc =
    video.title.length > 1000
      ? `${video.title.slice(0, 997)}…`
      : (video.title || '*(be pavadinimo)*');

  return new EmbedBuilder()
    .setTitle('Naujas kontentas')
    .setURL(video.url)
    .setColor(0x5865f2)
    .addFields(
      { name: 'Video ID', value: `\`${video.videoId}\``, inline: true },
      { name: 'Pavadinimas', value: titleTrunc, inline: false },
      {
        name: 'RSS „published“',
        value: formatYoutubePublishedForLog(video.published),
        inline: true,
      }
    )
    .setFooter({ text: 'YouTube polling' })
    .setTimestamp();
}

async function logYoutubeAnnouncementDebug(client, video) {
  const id = config.logChannelId;
  if (!id) return;
  const ch = client.channels.cache.get(id);
  if (!ch?.send) return;
  try {
    await ch.send({ embeds: [buildYoutubeStaffLogEmbed(video)] });
  } catch (e) {
    console.warn('[youtube] nepavyko išsiųsti į LOG_CHANNEL_ID:', e?.message || e);
  }
}

async function fetchLatestVideoFromRssUrl(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
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

  return {
    videoId,
    title: titleStr,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    author: entry.author?.name || 'YouTube',
    published: entry.published,
  };
}

async function fetchLatestYoutubeVideoForLive(ytChannelId) {
  // Bandome kelis YouTube live RSS variantus: kai kurie kanalai/feeds elgiasi skirtingai,
  // o tikslas — pagauti LIVE pradžią žymiai anksčiau nei standartinis RSS.
  const liveUrls = [
    `${RSS_BASE}${ytChannelId}&live=1`,
    `${RSS_BASE}${ytChannelId}&activity_types=live`,
  ];

  for (const url of liveUrls) {
    try {
      const v = await fetchLatestVideoFromRssUrl(url);
      if (v?.videoId) return v;
    } catch (_) {
      // next variantas
    }
  }
  return null;
}

async function fetchLatestYoutubeVideoFromRss(ytChannelId) {
  return fetchLatestVideoFromRssUrl(`${RSS_BASE}${ytChannelId}`);
}

function isYoutubeVideoAlreadyAnnounced(ytChannelId, videoId) {
  const row = db
    .prepare(
      `SELECT 1 FROM youtube_announced_videos
       WHERE yt_channel_id = ? AND video_id = ?`
    )
    .get(ytChannelId, videoId);
  return Boolean(row);
}

function isYoutubeTitleAlreadyAnnounced(ytChannelId, titleNorm) {
  const row = db
    .prepare(
      `SELECT 1 FROM youtube_announced_titles
       WHERE yt_channel_id = ? AND title_norm = ?`
    )
    .get(ytChannelId, titleNorm);
  return Boolean(row);
}

async function maybeAnnounceYoutubeVideo(client, video) {
  const ytId = config.youtubeChannelId;
  if (!ytId || !video?.videoId) return;

  const announceChannel = config.youtubeAnnounceChannelId
    ? client.channels.cache.get(config.youtubeAnnounceChannelId)
    : null;

  if (!announceChannel?.send) return;

  const videoKey = `${ytId}:${video.videoId}`;
  if (announcingVideoKeys.has(videoKey)) return;
  if (isYoutubeVideoAlreadyAnnounced(ytId, video.videoId)) return;

  const titleNorm = normalizeAnnouncementTitle(video.title);
  if (isYoutubeTitleAlreadyAnnounced(ytId, titleNorm)) return;

  announcingVideoKeys.add(videoKey);
  try {
    await announceChannel.send({
      content: announceContent,
      embeds: [buildYoutubeEmbed(video)],
      components: [buildWatchButtons(video.url)],
    });

    await logYoutubeAnnouncementDebug(client, video);

    db.prepare(
      `INSERT INTO youtube_state (yt_channel_id, last_video_id)
       VALUES (?, ?)
       ON CONFLICT (yt_channel_id) DO UPDATE SET last_video_id = excluded.last_video_id`
    ).run(ytId, video.videoId);

    db.prepare(
      `INSERT INTO youtube_announced_videos (yt_channel_id, video_id)
       VALUES (?, ?)
       ON CONFLICT (yt_channel_id, video_id) DO NOTHING`
    ).run(ytId, video.videoId);

    db.prepare(
      `INSERT INTO youtube_announced_titles (yt_channel_id, title_norm)
       VALUES (?, ?)
       ON CONFLICT (yt_channel_id, title_norm) DO NOTHING`
    ).run(ytId, titleNorm);
  } finally {
    announcingVideoKeys.delete(videoKey);
  }
}

let liveInFlight = false;
let rssInFlight = false;
const announcingVideoKeys = new Set();

async function checkYoutubeLive(client) {
  const ytId = config.youtubeChannelId;
  if (!ytId) return;
  if (liveInFlight) return;
  liveInFlight = true;

  try {
    const video = await fetchLatestYoutubeVideoForLive(ytId);
    if (!video) return;

    await maybeAnnounceYoutubeVideo(client, video);
  } catch (e) {
    console.error('[youtube][live] poll error:', e?.message || e);
  } finally {
    liveInFlight = false;
  }
}

async function checkYoutubeRss(client) {
  const ytId = config.youtubeChannelId;
  if (!ytId) return;
  if (rssInFlight) return;
  rssInFlight = true;

  try {
    const video = await fetchLatestYoutubeVideoFromRss(ytId);
    if (!video) return;

    await maybeAnnounceYoutubeVideo(client, video);
  } catch (e) {
    console.error('[youtube][rss] poll error:', e?.message || e);
  } finally {
    rssInFlight = false;
  }
}

function startLiveStreamPoller(client) {
  const ytId = config.youtubeChannelId;
  if (!ytId) return;

  // youtube_state eilutės užtikrinimas (kad UPDATE turėtų efektą).
  db.prepare(
    `INSERT INTO youtube_state (yt_channel_id, last_video_id)
     VALUES (?, '')
     ON CONFLICT (yt_channel_id) DO NOTHING`
  ).run(ytId);

  // Paleidimas iš karto po bot starto.
  checkYoutubeLive(client);
  checkYoutubeRss(client);

  const liveMs = config.youtubeLivePollIntervalMs || 90000;
  const rssMs = config.youtubeRssPollIntervalMs || 300000;

  setInterval(() => checkYoutubeLive(client), liveMs);
  setInterval(() => checkYoutubeRss(client), rssMs);
}

module.exports = {
  startLiveStreamPoller,
};

