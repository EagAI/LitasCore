const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { XMLParser } = require('fast-xml-parser');
const db = require('../db');
const config = require('../config');

const RSS_BASE = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const INTERVAL_MS = 5 * 60 * 1000;

const parser = new XMLParser({ ignoreAttributes: false });

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
  const videoId = entry['yt:videoId'];
  if (!videoId) return null;

  return {
    videoId,
    title: entry.title || 'Naujas video',
    url: `https://www.youtube.com/watch?v=${videoId}`,
    author: entry.author?.name || 'YouTube',
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    published: entry.published,
  };
}

async function checkChannels(client) {
  const announceChannel = client.channels.cache.get(config.youtubeAnnounceChannelId);
  if (!announceChannel) return;

  for (const ytId of config.youtubeChannelIds) {
    try {
      const video = await fetchLatestVideo(ytId);
      if (!video) continue;

      const dbRow = db
        .prepare('SELECT last_video_id FROM youtube_state WHERE yt_channel_id = ?')
        .get(ytId);

      if (!dbRow) {
        db.prepare('INSERT INTO youtube_state (yt_channel_id, last_video_id) VALUES (?, ?)').run(
          ytId,
          video.videoId
        );
        continue;
      }

      if (dbRow.last_video_id === video.videoId) continue;

      db.prepare('UPDATE youtube_state SET last_video_id = ? WHERE yt_channel_id = ?').run(
        video.videoId,
        ytId
      );

      const embed = new EmbedBuilder()
        .setTitle(video.title)
        .setURL(video.url)
        .setColor(0xff0000)
        .setImage(video.thumbnail);

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
    } catch (_) {}
  }
}

function startYoutubePoller(client) {
  if (config.youtubeChannelIds.length === 0) return;
  checkChannels(client);
  setInterval(() => checkChannels(client), INTERVAL_MS);
}

module.exports = { startYoutubePoller };
