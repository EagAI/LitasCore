const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const { isStaff } = require('../utils/permissions');
const { buildScamLogRow } = require('./scamLogButtons');

const ENABLED = (process.env.INVITE_LINK_BLOCK_ENABLED ?? 'true') !== 'false';
const TIMEOUT_MS = parseInt(
  process.env.INVITE_LINK_TIMEOUT_MS || process.env.SCAM_TIMEOUT_MS || String(24 * 60 * 60 * 1000),
  10
);
const ALERT_COOLDOWN_MS = parseInt(
  process.env.INVITE_LINK_ALERT_COOLDOWN_MS ||
    process.env.SCAM_ALERT_COOLDOWN_MS ||
    String(2 * 60 * 1000),
  10
);
const ALLOW_OWN_GUILD =
  (process.env.INVITE_LINK_ALLOW_OWN_GUILD ?? 'true').toLowerCase() !== 'false';

/** @type {Map<string, number>} */
const recentAlerts = new Map();

const INVITE_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite|discord\.me|discord\.io|discord\.li|discord\.com\/invite)\/([a-zA-Z0-9-]+(?:\?[^\s]*)?)/gi;

function alertKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function claimAlert(guildId, userId) {
  const key = alertKey(guildId, userId);
  const now = Date.now();
  const last = recentAlerts.get(key);
  if (last != null && now - last < ALERT_COOLDOWN_MS) {
    return false;
  }
  recentAlerts.set(key, now);
  if (recentAlerts.size > 2000) {
    for (const [k, ts] of recentAlerts) {
      if (now - ts >= ALERT_COOLDOWN_MS) recentAlerts.delete(k);
    }
  }
  return true;
}

function extractInviteMatches(content) {
  if (!content) return [];
  const out = [];
  let m;
  INVITE_URL_RE.lastIndex = 0;
  while ((m = INVITE_URL_RE.exec(content)) !== null) {
    const raw = m[0];
    const code = (m[1] || '').split('?')[0];
    if (code) out.push({ raw, code });
  }
  return out;
}

async function isAllowedOwnGuildInvite(code, guild, client) {
  if (!ALLOW_OWN_GUILD) return false;
  try {
    const invite = await client.fetchInvite(code);
    return invite.guild?.id === guild.id;
  } catch {
    return false;
  }
}

async function applyTimeout(member) {
  try {
    await member.timeout(TIMEOUT_MS, 'Automatinis — Discord pakvietimo nuoroda');
  } catch (e) {
    if (e?.code === 50013) {
      console.warn(
        '[invlink] Nėra teisių „Timeout Members“ arba narys aukštesnis už botą.'
      );
    } else {
      console.error('[invlink] Timeout nepavyko:', e?.message || e);
    }
  }
}

async function deleteMessage(message) {
  try {
    await message.delete();
  } catch (e) {
    if (e?.code === 50013) {
      console.warn('[invlink] Nepavyko ištrinti žinutės — reikia Manage Messages.');
    } else {
      console.error('[invlink] Nepavyko ištrinti žinutės:', e?.message || e);
    }
  }
}

/**
 * Blokuoja Discord pakvietimų nuorodas (ne savo serverio, jei ALLOW_OWN_GUILD).
 * @param {import('discord.js').Message} message
 */
async function handleAntiInviteLink(message) {
  if (!ENABLED) return;
  if (message.webhookId) return;
  if (!message.guild || !message.member) return;
  if (isStaff(message.member)) return;

  const matches = extractInviteMatches(message.content);
  if (matches.length === 0) return;

  const blocked = [];
  for (const match of matches) {
    const allowed = await isAllowedOwnGuildInvite(match.code, message.guild, message.client);
    if (!allowed) blocked.push(match);
  }

  if (blocked.length === 0) return;

  const postAlert = claimAlert(message.guildId, message.author.id);
  await applyTimeout(message.member);

  if (!postAlert) {
    await deleteMessage(message);
    return;
  }

  const targetChannelId = config.adminActionsChannelId || config.logChannelId;
  const logCh = message.guild.channels.cache.get(targetChannelId);

  const jump =
    message.url ||
    `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;

  const linkLines = blocked
    .map(m => `• \`${m.code}\` — ${m.raw.slice(0, 120)}`)
    .join('\n')
    .slice(0, 1024);

  const timeoutHours = Math.round(TIMEOUT_MS / 3600000);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Discord pakvietimo nuoroda')
    .setDescription(
      `Narys gavo **${timeoutHours} val. timeout**. **Kanalo žinutė ištrinta.**`
    )
    .addFields(
      { name: 'Narys', value: `${message.author} (\`${message.author.id}\`)`, inline: true },
      { name: 'Kanalas', value: `${message.channel}`, inline: true },
      {
        name: 'Originali žinutė',
        value: `ID: \`${message.id}\`\n[Prieš trinant](${jump})`,
        inline: false,
      },
      { name: 'Rastos nuorodos', value: linkLines || '—', inline: false },
      {
        name: 'Turinys',
        value: message.content ? `\`\`\`${message.content.slice(0, 900)}\`\`\`` : '—',
        inline: false,
      }
    )
    .setFooter({ text: 'Automatinis invite filtras — naudokite mygtukus atsargiai.' })
    .setTimestamp();

  const row = buildScamLogRow(message.guildId, message.author.id);

  if (logCh?.isTextBased()) {
    try {
      await logCh.send({ embeds: [embed], components: [row] });
    } catch (e) {
      if (e?.code === 50013) {
        console.warn('[invlink] Admin kanale nėra teisių siųsti žinutes.');
      } else {
        console.error('[invlink] Siuntimas į admin kanalą nepavyko:', e?.message || e);
      }
    }
  } else {
    console.error('[invlink] Admin/log kanalas nerastas.');
  }

  await deleteMessage(message);
}

module.exports = { handleAntiInviteLink, extractInviteMatches };
