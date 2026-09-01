const db = require('../db');
const config = require('../config');
const { withAllowedMentions } = require('../utils/allowedMentions');

const CHECK_INTERVAL_MS = 60_000;
const STARTUP_DELAY_MS = 10_000;

let intervalHandle = null;
let lastScheduledTickKey = null;
const failCountByDate = new Map();

function dailyRolesLastDateKey(guildId) {
  return `daily_roles_last_date_${guildId}`;
}

function getTimezone() {
  return config.dailyRolesTimezone || 'Europe/Vilnius';
}

function getVilniusParts(date = new Date()) {
  const tz = getTimezone();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = type => parts.find(p => p.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);

  return {
    dateString: `${year}-${month}-${day}`,
    hour,
    minute,
  };
}

function getVilniusDateString(date = new Date()) {
  return getVilniusParts(date).dateString;
}

function getVilniusHourMinute(date = new Date()) {
  const { hour, minute } = getVilniusParts(date);
  return { hour, minute };
}

function wasPostedToday(guildId, dateString = getVilniusDateString()) {
  const row = db
    .prepare('SELECT value FROM bot_config WHERE key = ?')
    .get(dailyRolesLastDateKey(guildId));
  return row?.value === dateString;
}

function markPostedToday(guildId, dateString = getVilniusDateString()) {
  db.prepare('INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)').run(
    dailyRolesLastDateKey(guildId),
    dateString
  );
}

function isAtScheduledTime(hour, minute) {
  return hour === config.dailyRolesHour && minute === config.dailyRolesMinute;
}

function isAfterScheduledTime(hour, minute) {
  const { dailyRolesHour: h, dailyRolesMinute: m } = config;
  return hour > h || (hour === h && minute > m);
}

function shouldAttemptPost(guildId, dateString, hour, minute) {
  if (wasPostedToday(guildId, dateString)) return false;

  if (isAtScheduledTime(hour, minute)) {
    const tickKey = `${dateString}-${hour}:${String(minute).padStart(2, '0')}`;
    if (lastScheduledTickKey === tickKey) return false;
    lastScheduledTickKey = tickKey;
    return true;
  }

  return isAfterScheduledTime(hour, minute);
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickThreeMembers(members) {
  const humans = members.filter(m => m?.user && !m.user.bot);
  shuffleInPlace(humans);
  return humans.slice(0, 3);
}

function buildDailyRolesMessage(members) {
  const [a, b, c] = members;
  return (
    `- Dienos anegdota skelia: <@${a.id}>\n` +
    `- Dienos daina pristato: <@${b.id}>\n` +
    `- Dienos klausima užduoda: <@${c.id}>`
  );
}

async function notifyLog(client, message) {
  const channelId = config.logChannelId;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel.send({ content: message }).catch(err => {
    console.warn('[dailyRoles] nepavyko siųsti į log kanalą:', err?.message || err);
  });
}

function recordFailure(dateString) {
  const count = (failCountByDate.get(dateString) || 0) + 1;
  failCountByDate.set(dateString, count);
  return count;
}

function clearFailure(dateString) {
  failCountByDate.delete(dateString);
}

async function tryPostDailyRoles(client) {
  if (!config.dailyRolesEnabled) return;
  if (!config.dailyRolesChannelId) {
    console.warn('[dailyRoles] DAILY_ROLES_CHANNEL_ID nenustatytas — praleidžiama.');
    return;
  }
  if (!config.guildId) {
    console.warn('[dailyRoles] GUILD_ID nenustatytas — praleidžiama.');
    return;
  }

  const guild = client.guilds.cache.get(config.guildId)
    || await client.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) {
    console.warn('[dailyRoles] Gildija nerasta:', config.guildId);
    return;
  }

  const { dateString, hour, minute } = getVilniusParts();
  if (!shouldAttemptPost(guild.id, dateString, hour, minute)) return;

  let channel;
  try {
    channel = guild.channels.cache.get(config.dailyRolesChannelId)
      || await guild.channels.fetch(config.dailyRolesChannelId);
  } catch (err) {
    const failCount = recordFailure(dateString);
    console.error('[dailyRoles] Kanalas nerastas:', err?.message || err);
    if (failCount >= 3) {
      await notifyLog(client, `⚠️ [dailyRoles] Kanalas \`${config.dailyRolesChannelId}\` nepasiekiamas (${failCount} bandymai šiandien).`);
    }
    return;
  }

  if (!channel?.isTextBased?.()) {
    const failCount = recordFailure(dateString);
    console.error('[dailyRoles] Kanalas nėra tekstinis arba nerastas.');
    if (failCount >= 3) {
      await notifyLog(client, `⚠️ [dailyRoles] Kanalas \`${config.dailyRolesChannelId}\` nėra tekstinis (${failCount} bandymai šiandien).`);
    }
    return;
  }

  let members;
  try {
    members = await guild.members.fetch();
  } catch (err) {
    const failCount = recordFailure(dateString);
    console.error('[dailyRoles] Nepavyko fetch narių:', err?.message || err);
    if (failCount >= 3) {
      await notifyLog(client, `⚠️ [dailyRoles] Nepavyko gauti narių sąrašo (${failCount} bandymai šiandien).`);
    }
    return;
  }

  const picked = pickThreeMembers([...members.values()]);
  if (picked.length < 3) {
    const failCount = recordFailure(dateString);
    console.warn(
      `[dailyRoles] Per mažai žmonių (${picked.length}/3) — laukiama, kol bus pakankamai narių.`
    );
    if (failCount >= 3) {
      await notifyLog(
        client,
        `⚠️ [dailyRoles] Per mažai narių dienos roles žinutei (${picked.length}/3, ${failCount} bandymai šiandien).`
      );
    }
    return;
  }

  const content = buildDailyRolesMessage(picked);
  try {
    await channel.send(withAllowedMentions({ content }, { pingUsers: true }));
    markPostedToday(guild.id, dateString);
    clearFailure(dateString);
    console.log(`[dailyRoles] Paskelbta ${dateString} ${hour}:${String(minute).padStart(2, '0')} (${getTimezone()}).`);
  } catch (err) {
    const failCount = recordFailure(dateString);
    console.error('[dailyRoles] Nepavyko išsiųsti žinutės:', err?.message || err);
    if (failCount >= 3) {
      await notifyLog(
        client,
        `⚠️ [dailyRoles] Nepavyko išsiųsti į <#${config.dailyRolesChannelId}> (${failCount} bandymai šiandien): ${err?.message || err}`
      );
    }
  }
}

function startDailyRolesScheduler(client) {
  if (!config.dailyRolesEnabled) {
    console.log('[dailyRoles] Išjungta (DAILY_ROLES_ENABLED=false).');
    return;
  }

  if (intervalHandle) return;

  console.log(
    `[dailyRoles] Scheduler: ${String(config.dailyRolesHour).padStart(2, '0')}:${String(config.dailyRolesMinute).padStart(2, '0')} ${getTimezone()} → kanalas ${config.dailyRolesChannelId || '(nenustatytas)'}`
  );

  setTimeout(() => {
    tryPostDailyRoles(client).catch(err => {
      console.error('[dailyRoles] Startup tick klaida:', err?.message || err);
    });
  }, STARTUP_DELAY_MS);

  intervalHandle = setInterval(() => {
    tryPostDailyRoles(client).catch(err => {
      console.error('[dailyRoles] Tick klaida:', err?.message || err);
    });
  }, CHECK_INTERVAL_MS);
}

module.exports = {
  startDailyRolesScheduler,
  tryPostDailyRoles,
  getVilniusDateString,
  getVilniusHourMinute,
  getVilniusParts,
  wasPostedToday,
  markPostedToday,
  shouldAttemptPost,
  pickThreeMembers,
  buildDailyRolesMessage,
};
