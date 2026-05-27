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

const adminLiveTestContent = 'LITAS dabar LIVE ❗ Pažiūrim😱';

const YT_FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

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

const LIVE_TEST_SOURCE_LABELS = {
  live_probe: 'YouTube `/live` probe',
  live_rss: 'YouTube live RSS',
};

function formatLiveTestError(err) {
  const msg = String(err?.message || err || 'Nežinoma klaida');
  if (err?.name === 'TimeoutError' || /timeout/i.test(msg)) {
    return `Timeout — ${msg}`;
  }
  return msg.slice(0, 500);
}

function describeLiveTestCheck(check) {
  if (check.status === 'found') return '✅ rastas LIVE';
  if (check.status === 'empty') return '⚪ tuščia (ne LIVE)';
  if (check.status === 'error') return `❌ ${check.error}`;
  if (check.status === 'skipped') return '⏭ praleista (jau rasta /live probe)';
  return '—';
}

function buildAdminTestLiveLogEmbed(data) {
  const { ok, reason, source, video, checks, requestedBy, message, announced } = data;

  let color = 0x5865f2;
  if (ok) color = 0x57f287;
  else if (reason === 'not_live') {
    color = checks.probe.error || checks.liveRss.error ? 0xed4245 : 0xfaa61a;
  } else {
    color = 0xed4245;
  }

  const embed = new EmbedBuilder()
    .setTitle(ok ? 'Admin test live — sėkmė' : 'Admin test live — nesėkmė')
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: '/admin test live' });

  if (requestedBy) {
    embed.addFields({ name: 'Paleido', value: requestedBy, inline: true });
  }

  embed.addFields(
    { name: 'YouTube `/live` probe', value: describeLiveTestCheck(checks.probe), inline: false },
    { name: 'YouTube live RSS', value: describeLiveTestCheck(checks.liveRss), inline: false }
  );

  if (ok && source) {
    embed.addFields({
      name: 'Suveikė',
      value: LIVE_TEST_SOURCE_LABELS[source] || source,
      inline: true,
    });
  }

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
    embed.addFields({
      name: 'Skelbimas',
      value: announced ? 'Išsiųstas į announce kanalą (be @everyone)' : 'Neišsiųstas',
      inline: true,
    });
  }

  if (message) {
    embed.addFields({ name: 'Rezultatas', value: message.slice(0, 1000), inline: false });
  }

  return embed;
}

async function logAdminTestLiveResult(client, data) {
  const id = config.logChannelId;
  if (!id) return;
  const ch = client.channels.cache.get(id);
  if (!ch?.send) return;
  try {
    await ch.send({ embeds: [buildAdminTestLiveLogEmbed(data)] });
  } catch (e) {
    console.warn('[youtube][live][test] LOG_CHANNEL_ID:', e?.message || e);
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

async function probeYoutubeLivePage(ytChannelId) {
  const res = await fetch(
    `https://www.youtube.com/channel/${encodeURIComponent(ytChannelId)}/live`,
    {
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
      headers: YT_FETCH_HEADERS,
    }
  );

  const finalUrl = res.url || '';
  const html = await res.text();

  if (html.includes('LIVE_STREAM_OFFLINE') || /"isLive"\s*:\s*false/.test(html)) {
    return null;
  }

  const videoId =
    finalUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/)?.[1] ||
    html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/)?.[1] ||
    null;

  if (!videoId) return null;

  const isLive =
    finalUrl.includes('/watch') ||
    /"isLive"\s*:\s*true/.test(html) ||
    /"style"\s*:\s*"LIVE"/.test(html);

  if (!isLive) return null;

  let title = 'LIVE';
  const titleMatch = html.match(/"title"\s*:\s*\{"runs":\[\{"text":"([^"]+)"/);
  if (titleMatch?.[1]) title = titleMatch[1];

  return {
    videoId,
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    author: 'YouTube',
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

async function forceTestLiveAnnouncement(client, options = {}) {
  const requestedBy = options.requestedBy || null;
  const checks = {
    probe: { status: 'pending', error: null },
    liveRss: { status: 'pending', error: null },
  };

  const finish = async result => {
    await logAdminTestLiveResult(client, {
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

    let video = null;
    let source = null;

    try {
      video = await probeYoutubeLivePage(ytId);
      checks.probe.status = video ? 'found' : 'empty';
    } catch (e) {
      checks.probe.status = 'error';
      checks.probe.error = formatLiveTestError(e);
      console.warn('[youtube][live][test] /live probe:', e?.message || e);
    }

    if (video) {
      source = 'live_probe';
      checks.liveRss.status = 'skipped';
    } else {
      try {
        video = await fetchLatestYoutubeVideoForLive(ytId);
        checks.liveRss.status = video ? 'found' : 'empty';
        if (video) source = 'live_rss';
      } catch (e) {
        checks.liveRss.status = 'error';
        checks.liveRss.error = formatLiveTestError(e);
        console.warn('[youtube][live][test] live RSS:', e?.message || e);
      }
    }

    const hasErrors = checks.probe.status === 'error' || checks.liveRss.status === 'error';

    if (!video) {
      const message = hasErrors
        ? 'LIVE nerastas — `/live` arba live RSS metu įvyko klaida (detalės log kanale).'
        : 'Litas šiuo metu ne LIVE (YouTube /live ir live RSS tušti).';
      return finish({
        ok: false,
        reason: hasErrors ? 'error' : 'not_live',
        message,
        announced: false,
      });
    }

    await announceChannel.send({
      content: adminLiveTestContent,
      embeds: [buildYoutubeEmbed(video)],
      components: [buildWatchButtons(video.url)],
    });

    const sourceLabel = LIVE_TEST_SOURCE_LABELS[source] || source;
    return finish({
      ok: true,
      reason: 'live',
      source,
      video,
      announced: true,
      message: `LIVE rastas per **${sourceLabel}** — testinis skelbimas išsiųstas (be @everyone): **${video.title}** (\`${video.videoId}\`).`,
    });
  } catch (e) {
    const message = formatLiveTestError(e);
    console.error('[youtube][live][test] fatal:', e?.stack || e?.message || e);
    await logAdminTestLiveResult(client, {
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
  forceTestLiveAnnouncement,
};

