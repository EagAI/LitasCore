const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { ocrImage } = require('../antiscam/ocrImage');
const { scoreText } = require('../antiscam/scoreText');
const config = require('../config');
const { buildScamLogRow } = require('./scamLogButtons');

const ENABLED = (process.env.SCAM_SCAN_ENABLED ?? 'true') !== 'false';
const THRESHOLD = parseInt(process.env.SCAM_SCORE_THRESHOLD ?? '4', 10);
const TIMEOUT_MS = parseInt(process.env.SCAM_TIMEOUT_MS || String(24 * 60 * 60 * 1000), 10);
const MAX_LOG_FILES = 10;

const ALLOWED_CHANNELS = process.env.SCAM_SCAN_CHANNEL_IDS
  ? new Set(process.env.SCAM_SCAN_CHANNEL_IDS.split(',').map(s => s.trim()).filter(Boolean))
  : null;

/**
 * Paveikslų OCR + įvertinimas. Jei suveikia — 24h timeout, be reakcijos ir be viešo atsakymo;
 * pranešimas į admin/mod kanalą (adminActionsChannelId) su priedais ir mygtukais.
 * @param {import('discord.js').Message} message
 */
async function handleAntiScam(message) {
  if (!ENABLED) return;
  if (message.webhookId) return;
  if (ALLOWED_CHANNELS && !ALLOWED_CHANNELS.has(message.channelId)) return;

  const imageAttachments = message.attachments.filter(att => {
    const mime = (att.contentType ?? '').split(';')[0].trim().toLowerCase();
    return mime.startsWith('image/') && mime !== 'image/gif' && att.size > 0;
  });

  if (imageAttachments.size === 0) return;

  let anyTriggered = false;
  let bestScore = 0;
  const allReasons = new Set();
  for (const [, att] of imageAttachments) {
    let text;
    try {
      text = await ocrImage(att.url, att.contentType, att.size);
    } catch (err) {
      console.error('[antiscam] OCR error', err?.message);
      continue;
    }
    if (!text) continue;
    const { score, reasons, triggered } = scoreText(text);
    if (triggered) anyTriggered = true;
    if (score > bestScore) bestScore = score;
    for (const r of reasons) allReasons.add(r);
  }

  if (!anyTriggered) return;

  const reasonList = allReasons.size
    ? [...allReasons].map(r => `• ${r}`).join('\n')
    : '• Įtartina';

  const member = message.member;
  if (!member) return;

  try {
    await member.timeout(TIMEOUT_MS, 'Automatinis antiscam (OCR) — įtartinas paveikslas');
  } catch (e) {
    if (e?.code === 50013) {
      console.warn(
        '[antiscam] Nėra teisių „Timeout Members“ (Moderate Members) arba narys aukštesnis už botą.'
      );
    } else {
      console.error('[antiscam] Timeout nepavyko:', e?.message || e);
    }
  }

  const targetChannelId = config.adminActionsChannelId || config.logChannelId;
  if (!config.adminActionsChannelId) {
    console.warn(
      '[antiscam] ADMIN_ACTIONS_CHANNEL_ID nenustatytas — naudojamas logChannelId. Rekomenduojama atskiras admin kanalas.'
    );
  }
  const logCh = message.guild.channels.cache.get(targetChannelId);
  if (!logCh?.isTextBased()) {
    console.error(
      '[antiscam] Admin/log kanalas nerastas (adminActionsChannelId / logChannelId).'
    );
  }

  const files = [];
  let idx = 0;
  for (const [, att] of imageAttachments) {
    if (idx >= MAX_LOG_FILES) break;
    try {
      const res = await fetch(att.url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const ext =
        (att.name && att.name.includes('.')) ? att.name.split('.').pop() : 'png';
      files.push(
        new AttachmentBuilder(buf, { name: `scam-${message.id}-${idx + 1}.${ext}` })
      );
      idx++;
    } catch (err) {
      console.error('[antiscam] Nepavyko atsisiųsti priedo', err?.message);
    }
  }

  if (imageAttachments.size > MAX_LOG_FILES) {
    // still noted in embed
  }

  const jump =
    message.url ||
    `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;

  const embed = new EmbedBuilder()
    .setColor(0xff6600)
    .setTitle('Sukčiavimo įtartino paveikslo nuskaitymas')
    .setDescription(
      'Narys gavo **24 val. timeout** (galima koreguoti / nuimti žemiau). ' +
        'Nuotraukos žemiau = nukopijuoti priedai; **kanalo žinutė ištrinta**.'
    )
    .addFields(
      { name: 'Narys', value: `${message.author} (\`${message.author.id}\`)`, inline: true },
      { name: 'Kanalas', value: `${message.channel}`, inline: true },
      {
        name: 'Originali žinutė',
        value:
          `ID: \`${message.id}\`\n[Prieš trinant](${jump}) — dabar nebegalioja, nes ištrinta.`,
        inline: false,
      },
      { name: 'Signalai', value: reasonList.slice(0, 1024) || '—', inline: false },
      {
        name: 'Balas',
        value: `**${bestScore}** / slenkstis **${THRESHOLD}**`,
        inline: true,
      }
    )
    .setFooter({ text: 'Automatinis skenavimas — gali klysti. Naudokite mygtukus atsargiai.' })
    .setTimestamp();

  if (imageAttachments.size > MAX_LOG_FILES) {
    embed.addFields({
      name: 'Pastaba',
      value: `Rodyta tik pirmi ${MAX_LOG_FILES} priedai iš ${imageAttachments.size}.`,
      inline: false,
    });
  }

  const row = buildScamLogRow(message.guildId, message.author.id);

  if (logCh?.isTextBased()) {
    try {
      await logCh.send({ embeds: [embed], files, components: [row] });
    } catch (e) {
      if (e?.code === 50013) {
        console.warn('[antiscam] Log kanale nėra teisių: Send Messages, Attach Files, Embed.');
      } else {
        console.error('[antiscam] Siuntimas į log kanalą nepavyko:', e?.message || e);
      }
    }
  }

  try {
    await message.delete();
  } catch (e) {
    if (e?.code === 50013) {
      console.warn(
        '[antiscam] Nepavyko ištrinti originalios žinutės — reikia „Manage Messages“ kanale, kur buvo postas.'
      );
    } else {
      console.error('[antiscam] Nepavyko ištrinti žinutės:', e?.message || e);
    }
  }
}

module.exports = { handleAntiScam };
