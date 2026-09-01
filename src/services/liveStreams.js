const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { XMLParser } = require('fast-xml-parser');
const db = require('../db');
const config = require('../config');
const { withAllowedMentions } = require('../utils/allowedMentions');

const RSS_BASE = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const RSS_POLL_MS_DEFAULT = 2 * 60 * 1000;

const announceContent =
  'Opa @everyone, LITAS ką tik naujo kontento pakūrė❗ Pažiūrim😱';

const adminLiveTestContent = 'LITAS dabar LIVE ❗ Pažiūrim😱';

const YT_FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const parser = new XMLParser({ ignoreAttributes: false });

function lastResortImageUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
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
    .setFooter({ text: 'YouTube RSS' })
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

function formatLiveTestError(err) {
  const msg = String(err?.message || err || 'Nežinoma klaida');
  if (err?.name === 'TimeoutError' || /timeout/i.test(msg)) {
    return `Timeout — ${msg}`;
  }
  return msg.slice(0, 500);
}

function describeRssCheck(check) {
  if (check.status === 'found') return '✅ naujausias įrašas gautas';
  if (check.status === 'empty') return '⚪ feed tuščias';
  if (check.status === 'error') return `❌ ${check.error}`;
  return '—';
}

function buildAdminLiveActionLogEmbed(data) {
  const { kind, ok, reason, video, checks, requestedBy, message, announced } = data;
  const isTest = kind === 'test';
  const label = isTest ? 'Admin test live' : 'Admin live check';
  const footer = isTest ? '/admin test live' : '/admin live check';

  let color = 0x5865f2;
  if (ok && reason === 'already_posted') color = 0xfaa61a;
  else if (ok) color = 0x57f287;
  else if (reason === 'not_new') color = 0xfaa61a;
  else color = 0xed4245;

  const embed = new EmbedBuilder()
    .setTitle(ok ? `${label} — sėkmė` : `${label} — nesėkmė`)
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: footer });

  if (requestedBy) {
    embed.addFields({ name: 'Paleido', value: requestedBy, inline: true });
  }

  embed.addFields({
    name: 'YouTube RSS',
    value: describeRssCheck(checks.rss),
    inline: false,
  });

  if (video) {
    const titleTrunc =
      video.title.length > 1000 ? `${video.title.slice(0, 997)}…` : (video.title || '*(be pavadinimo)*');
    embed.addFields(
      { name: 'Video ID', value: `\`${video.videoId}\``, inline: true },
      { name: 'Pavadinimas', value: titleTrunc, inline: false },
      { name: 'Nuoroda', value: video.url, inline: false }
    );
  }

  if (typeof announced === 'boolean') {
    const announceText = announced
      ? isTest
        ? 'Išsiųstas į announce kanalą (be @everyone)'
        : 'Išsiųstas į announce kanalą (su @everyone)'
      : 'Neišsiųstas';
    embed.addFields({ name: 'Skelbimas', value: announceText, inline: true });
  }

  if (message) {
    embed.addFields({ name: 'Rezultatas', value: message.slice(0, 1000), inline: false });
  }

  return embed;
}

async function logAdminLiveActionResult(client, data) {
  const id = config.logChannelId;
  if (!id) return;
  const ch = client.channels.cache.get(id);
  if (!ch?.send) return;
  try {
    await ch.send({ embeds: [buildAdminLiveActionLogEmbed(data)] });
  } catch (e) {
    console.warn('[youtube][admin] LOG_CHANNEL_ID:', e?.message || e);
  }
}

function parseVideosFromRssXml(xml, limit = 1) {
  const parsed = parser.parse(xml);
  const rawEntries = parsed?.feed?.entry;
  if (!rawEntries) return [];

  const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
  const out = [];

  for (const entry of entries.slice(0, limit)) {
    const videoId = entry['yt:videoId'] || entry.videoId;
    if (!videoId) continue;

    const titleRaw = entry.title;
    const titleStr =
      typeof titleRaw === 'string'
        ? titleRaw
        : titleRaw && typeof titleRaw === 'object' && titleRaw['#text']
          ? String(titleRaw['#text'])
          : 'Naujas video';

    out.push({
      videoId,
      title: titleStr,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      author: entry.author?.name || 'YouTube',
      published: entry.published,
    });
  }

  return out;
}

async function fetchNewestVideoFromChannelRss(ytChannelId) {
  const url = `${RSS_BASE}${ytChannelId}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: YT_FETCH_HEADERS,
  });

  if (!res.ok) {
    if (res.status === 404) {
      console.warn('[youtube][rss] 404 — patikrink YOUTUBE_CHANNEL_ID (UC…).');
    }
    throw new Error(`RSS HTTP ${res.status}`);
  }

  const xml = await res.text();
  const entries = parseVideosFromRssXml(xml, 1);
  return entries[0] ?? null;
}

async function detectYoutubeFromRss(ytChannelId) {
  const checks = { rss: { status: 'pending', error: null } };

  try {
    const video = await fetchNewestVideoFromChannelRss(ytChannelId);
    checks.rss.status = video ? 'found' : 'empty';
    return { video, checks };
  } catch (e) {
    checks.rss.status = 'error';
    checks.rss.error = formatLiveTestError(e);
    console.warn('[youtube][rss]:', e?.message || e);
    return { video: null, checks };
  }
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

async function maybeAnnounceYoutubeVideo(client, video) {
  const ytId = config.youtubeChannelId;
  if (!ytId || !video?.videoId) return { posted: false, reason: 'missing_video' };

  const announceChannel = config.youtubeAnnounceChannelId
    ? client.channels.cache.get(config.youtubeAnnounceChannelId)
    : null;

  if (!announceChannel?.send) return { posted: false, reason: 'no_channel' };

  const videoKey = `${ytId}:${video.videoId}`;
  if (announcingVideoKeys.has(videoKey)) return { posted: false, reason: 'in_flight' };
  if (isYoutubeVideoAlreadyAnnounced(ytId, video.videoId)) {
    return { posted: false, reason: 'already_announced_video' };
  }

  announcingVideoKeys.add(videoKey);
  try {
    await announceChannel.send(
      withAllowedMentions({
        content: announceContent,
        embeds: [buildYoutubeEmbed(video)],
        components: [buildWatchButtons(video.url)],
      })
    );

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

    return { posted: true };
  } finally {
    announcingVideoKeys.delete(videoKey);
  }
}

let rssInFlight = false;
const announcingVideoKeys = new Set();

async function checkYoutubeRss(client) {
  const ytId = config.youtubeChannelId;
  if (!ytId) return;
  if (rssInFlight) return;
  rssInFlight = true;

  try {
    const video = await fetchNewestVideoFromChannelRss(ytId);
    if (!video) return;

    await maybeAnnounceYoutubeVideo(client, video);
  } catch (e) {
    console.error('[youtube][rss] poll error:', e?.message || e);
  } finally {
    rssInFlight = false;
  }
}

async function forceTestLiveAnnouncement(client, options = {}) {
  const requestedBy = options.requestedBy || null;
  const checks = { rss: { status: 'pending', error: null } };

  const finish = async result => {
    await logAdminLiveActionResult(client, {
      kind: 'test',
      ...result,
      checks,
      requestedBy,
    });
    return { ok: result.ok, message: result.message };
  };

  try {
    const ytId = config.youtubeChannelId;
    if (!ytId) {
      return finish({
        ok: false,
        reason: 'config',
        message: 'YOUTUBE_CHANNEL_ID nenustatytas .env.',
      });
    }

    const announceChannelId = config.youtubeAnnounceChannelId;
    if (!announceChannelId) {
      return finish({
        ok: false,
        reason: 'config',
        message: 'YOUTUBE_ANNOUNCE_CHANNEL_ID nenustatytas .env.',
      });
    }

    const announceChannel = client.channels.cache.get(announceChannelId);
    if (!announceChannel?.send) {
      return finish({
        ok: false,
        reason: 'config',
        message: 'Skelbimo kanalas nerastas arba botas negali ten siųsti.',
      });
    }

    const detected = await detectYoutubeFromRss(ytId);
    Object.assign(checks, detected.checks);
    const { video } = detected;

    if (!video) {
      const message =
        checks.rss.status === 'error'
          ? 'RSS klaida — detalės log kanale.'
          : 'RSS feed tuščias arba kanalas nerastas.';
      return finish({
        ok: false,
        reason: checks.rss.status === 'error' ? 'error' : 'not_new',
        message,
        announced: false,
      });
    }

    await announceChannel.send(
      withAllowedMentions({
        content: adminLiveTestContent,
        embeds: [buildYoutubeEmbed(video)],
        components: [buildWatchButtons(video.url)],
      })
    );

    return finish({
      ok: true,
      reason: 'rss',
      video,
      announced: true,
      message: `Naujausias RSS įrašas — testinis skelbimas išsiųstas (be @everyone): **${video.title}** (\`${video.videoId}\`).`,
    });
  } catch (e) {
    const message = formatLiveTestError(e);
    console.error('[youtube][test] fatal:', e?.stack || e?.message || e);
    await logAdminLiveActionResult(client, {
      kind: 'test',
      ok: false,
      reason: 'fatal',
      message,
      checks,
      requestedBy,
      announced: false,
    });
    return { ok: false, message: `Klaida: ${message}` };
  }
}

async function adminLiveCheck(client, options = {}) {
  const requestedBy = options.requestedBy || null;
  const checks = { rss: { status: 'pending', error: null } };

  const finish = async result => {
    await logAdminLiveActionResult(client, {
      kind: 'check',
      ...result,
      checks,
      requestedBy,
    });
    return { ok: result.ok, message: result.message };
  };

  try {
    const ytId = config.youtubeChannelId;
    if (!ytId) {
      return finish({
        ok: false,
        reason: 'config',
        message: 'YOUTUBE_CHANNEL_ID nenustatytas .env.',
      });
    }

    if (!config.youtubeAnnounceChannelId) {
      return finish({
        ok: false,
        reason: 'config',
        message: 'YOUTUBE_ANNOUNCE_CHANNEL_ID nenustatytas .env.',
      });
    }

    const detected = await detectYoutubeFromRss(ytId);
    Object.assign(checks, detected.checks);
    const { video } = detected;

    if (!video) {
      const message =
        checks.rss.status === 'error'
          ? 'RSS klaida — detalės log kanale.'
          : 'RSS feed tuščias arba kanalas nerastas.';
      return finish({
        ok: false,
        reason: checks.rss.status === 'error' ? 'error' : 'not_new',
        message,
        announced: false,
      });
    }

    const announceResult = await maybeAnnounceYoutubeVideo(client, video);

    if (announceResult.posted) {
      return finish({
        ok: true,
        reason: 'posted',
        video,
        announced: true,
        message: `Naujas RSS įrašas — skelbimas išsiųstas su @everyone: **${video.title}** (\`${video.videoId}\`).`,
      });
    }

    if (announceResult.reason === 'already_announced_video') {
      return finish({
        ok: true,
        reason: 'already_posted',
        video,
        announced: false,
        message: `RSS naujausias **${video.title}** (\`${video.videoId}\`) jau buvo skelbta — nieko nepostinta.`,
      });
    }

    const reasonMessages = {
      no_channel: 'Skelbimo kanalas nerastas arba botas negali ten siųsti.',
      in_flight: 'Skelbimas jau vykdomas — bandyk dar kartą po kelių sekundžių.',
      missing_video: 'RSS įrašas neturi video ID.',
    };

    return finish({
      ok: false,
      reason: announceResult.reason || 'unknown',
      video,
      announced: false,
      message: reasonMessages[announceResult.reason] || 'Skelbimo išsiųsti nepavyko.',
    });
  } catch (e) {
    const message = formatLiveTestError(e);
    console.error('[youtube][check] fatal:', e?.stack || e?.message || e);
    await logAdminLiveActionResult(client, {
      kind: 'check',
      ok: false,
      reason: 'fatal',
      message,
      checks,
      requestedBy,
      announced: false,
    });
    return { ok: false, message: `Klaida: ${message}` };
  }
}

function startLiveStreamPoller(client) {
  const ytId = config.youtubeChannelId;
  if (!ytId) return;

  db.prepare(
    `INSERT INTO youtube_state (yt_channel_id, last_video_id)
     VALUES (?, '')
     ON CONFLICT (yt_channel_id) DO NOTHING`
  ).run(ytId);

  const rssMs = config.youtubeRssPollIntervalMs || RSS_POLL_MS_DEFAULT;

  setTimeout(() => checkYoutubeRss(client), 10_000);
  setInterval(() => checkYoutubeRss(client), rssMs);
}

module.exports = {
  startLiveStreamPoller,
  forceTestLiveAnnouncement,
  adminLiveCheck,
};
