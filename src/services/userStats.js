const db = require('../db');
const {
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { getBalance } = require('./economy');
const { isStaff } = require('../utils/permissions');
const {
  getInviteStats,
  getInviteRecordForInvitee,
  getInvitesByInviter,
  countInvitesByInviter,
  getTrackingSince,
} = require('./inviteTracking');
const { withAllowedMentions } = require('../utils/allowedMentions');

const PREFIX = 'usrst';
/** description max ~ Discord 4096; paliekam vietos footer puslapiui */
const DESC_CHAR_BUDGET = 3800;

const USERSTATS_VIEWS = {
  overview: { label: 'Apžvalga', description: 'Paskyra, rolės, santrauka' },
  levels: { label: 'Lygiai', description: 'XP, lygis, litai, ženkleliai' },
  time: { label: 'Laikas serveryje', description: 'Sesijos ir kronika' },
  invites: { label: 'Pakvietimai', description: 'Ką pakvietė ir kas pakvietė' },
};

function logGuildMemberEvent(guildId, userId, kind) {
  try {
    if (kind !== 'join' && kind !== 'leave') return;
    db.prepare(
      `INSERT INTO guild_member_events (guild_id, user_id, kind, at_ms) VALUES (?, ?, ?, ?)`
    ).run(guildId, userId, kind, Date.now());
  } catch (e) {
    console.error('[userStats] log:', e?.message || e);
  }
}

function fetchEvents(guildId, userId) {
  try {
    return db
      .prepare(
        `SELECT kind, at_ms FROM guild_member_events
        WHERE guild_id = ? AND user_id = ?
        ORDER BY at_ms ASC, id ASC`
      )
      .all(guildId, userId);
  } catch (_) {
    return [];
  }
}

function analyzeSessions(events) {
  /** @type {{ join:number, leave:number }[]} */
  const completed = [];
  let openJoin = null;

  for (const e of events) {
    if (e.kind === 'join') {
      openJoin = e.at_ms;
    } else if (e.kind === 'leave' && openJoin !== null) {
      completed.push({ join: openJoin, leave: e.at_ms });
      openJoin = null;
    }
  }

  return { completed, openJoin };
}

function fmtDurMs(ms) {
  if (ms <= 0) return '—';
  let secTotal = Math.floor(ms / 1000);
  if (secTotal < 60) return `${secTotal} sek.`;
  const d = Math.floor(secTotal / 86400);
  secTotal %= 86400;
  const h = Math.floor(secTotal / 3600);
  secTotal %= 3600;
  const m = Math.floor(secTotal / 60);

  const parts = [];
  if (d) parts.push(`${d} d.`);
  if (h) parts.push(`${h} val.`);
  if (m || (!d && !h)) parts.push(`${m} min`);

  return parts.length ? parts.join(' ') : `${Math.max(1, Math.floor(ms / 1000))} sek.`;
}

function when(atMs) {
  const u = Math.floor(Number(atMs) / 1000);
  if (!Number.isFinite(u)) return '—';
  return `<t:${u}:f> · <t:${u}:R>`;
}

/** Grąžina eilutes pagal pasirinktą skiltį. */
function collectUserstatsLines(user, guild, memberMaybe, view = 'overview') {
  const guildId = guild.id;
  const events = fetchEvents(guildId, user.id);
  const { completed, openJoin } = analyzeSessions(events);

  const now = Date.now();
  let totalMs = completed.reduce((s, x) => s + (x.leave - x.join), 0);
  if (openJoin !== null) totalMs += now - openJoin;

  const levelRow = db
    .prepare(
      `SELECT xp, level, total_messages, total_voice_minutes FROM levels WHERE user_id = ? AND guild_id = ?`
    )
    .get(user.id, guildId);

  const bal = getBalance(user.id, guildId);
  const badgeCount =
    db
      .prepare(`SELECT COUNT(*) AS c FROM user_badges WHERE user_id = ? AND guild_id = ?`)
      .get(user.id, guildId)?.c ?? 0;

  const inviteStats = getInviteStats(user.id, guildId);
  const xpStr = levelRow ? Number(levelRow.xp).toLocaleString('lt-LT') : '';

  const lines = [];
  const viewKey = USERSTATS_VIEWS[view] ? view : 'overview';

  if (viewKey === 'overview' || viewKey === 'levels' || viewKey === 'time') {
    if (viewKey === 'overview') {
      lines.push(
        [
          '**Paskyra**',
          '```',
          user.id,
          '```',
          `**Discord klientas:** sukurtas ${when(user.createdTimestamp)}`,
          memberMaybe?.joinedTimestamp != null
            ? `**Šiame serveryje:** taip · prisijungė ${when(memberMaybe.joinedTimestamp)}`
            : '**Šiame serveryje:** ne',
          '',
          '**Rolės**',
          !memberMaybe
            ? '_Narys nerastas šiame serveryje — rolių sąrašo nėra._'
            : (() => {
                const roleMentions = memberMaybe.roles.cache
                  .filter(r => r.id !== guildId)
                  .sort((a, b) => b.position - a.position)
                  .map(r => r.toString());
                return roleMentions.length
                  ? roleMentions.join(', ')
                  : '_Be papildomų rolių (tik @everyone)._';
              })(),
          '',
          '**Santrauka**',
          [
            '```',
            [
              `Lygis           ${levelRow?.level ?? 0}`,
              `XP              ${xpStr || '0'}`,
              `Pakvietimai     ${inviteStats.validCount} (galiojantys)`,
              `Laikas serveryje ${fmtDurMs(totalMs)}`,
              `Litų            ${bal.toLocaleString('lt-LT')}`,
            ].join('\n'),
            '```',
          ].join('\n'),
        ].join('\n')
      );
    }

    if (viewKey === 'levels') {
      lines.push('**Lygiai ir ekonomika**');
      if (levelRow) {
        lines.push(
          [
            '```',
            [
              `Lygis           ${levelRow.level}`,
              `XP              ${xpStr}`,
              `Žinutės (viso)  ${levelRow.total_messages}`,
              `Voice (min)     ${levelRow.total_voice_minutes}`,
              `Litų            ${bal.toLocaleString('lt-LT')}`,
              `Ženklelių       ${badgeCount}`,
            ].join('\n'),
            '```',
          ].join('\n')
        );
      } else {
        lines.push('_Nėra įrašų apie lygius šiame serveryje._');
        lines.push(
          [
            '```',
            [
              `Litų            ${bal.toLocaleString('lt-LT')}`,
              `Ženklelių       ${badgeCount}`,
            ].join('\n'),
            '```',
          ].join('\n')
        );
      }
    }

    if (viewKey === 'time') {
      lines.push(
        [
          '**Laikas serveryje**',
          `_pagal saugomus prisijungimų ir išėjimų įrašus_`,
          '',
          `• Užbaigtų vizitų: **${completed.length}**`,
          `• Skaičiuojamas bendras buvimo laikas${openJoin !== null ? ' (+ dabartinė sesija)' : ''}: **${fmtDurMs(totalMs)}**`,
        ].join('\n')
      );

      if (completed.length > 0) {
        lines.push('');
        lines.push('**Sesijos (uždarytos)**');
        for (let i = 0; i < completed.length; i++) {
          const seg = completed[i];
          lines.push(
            [
              '',
              `**${i + 1}.** prisijungė · ${when(seg.join)}`,
              `     išėjo      · ${when(seg.leave)}`,
              `     trukmė     · **${fmtDurMs(seg.leave - seg.join)}**`,
            ].join('\n')
          );
        }
      }

      if (openJoin !== null) {
        lines.push('');
        lines.push(
          [
            '**Dabartinė sesija**',
            `pradžia ${when(openJoin)}`,
            `trukmė iki dabar · **${fmtDurMs(now - openJoin)}**`,
          ].join('\n')
        );
      }

      lines.push('');
      lines.push('**Įvykių kronika**');
      if (events.length === 0) {
        lines.push('_Įrašų nėra._');
      } else {
        lines.push('_Chronologija (nuo seniausio)_');
        lines.push('');
        for (const e of events) {
          const verb = e.kind === 'join' ? 'Prisijungė' : 'Išėjo';
          lines.push(`${verb} · ${when(e.at_ms)}`);
        }
      }
    }
  }

  if (viewKey === 'invites') {
    const invitedBy = getInviteRecordForInvitee(guildId, user.id);
    const validTotal = countInvitesByInviter(guildId, user.id, 'valid');
    const invalidTotal = countInvitesByInviter(guildId, user.id, 'invalid');
    const sinceTs = Math.floor(getTrackingSince() / 1000);

    lines.push('**Pakvietimai**');
    lines.push(
      [
        '```',
        [
          `Galiojančių     ${inviteStats.validCount}`,
          `Neįskaitytų     ${invalidTotal}`,
          `Kitas pasiekimas ${inviteStats.nextMilestone} (dar ${inviteStats.untilNext || 0})`,
        ].join('\n'),
        '```',
        '',
        `_Sekama nuo <t:${sinceTs}:D>; senesni pakvietimai neįtraukti._`,
      ].join('\n')
    );

    lines.push('');
    lines.push('**Kas pakvietė šį narį**');
    if (!invitedBy) {
      lines.push('_Nėra įrašo (prisijungė prieš sekimo pradžią arba ne per invite)._');
    } else if (invitedBy.inviter_id) {
      const statusNote =
        invitedBy.status === 'valid'
          ? 'galiojantis'
          : `neįskaitytas (${invitedBy.invalid_reason || '—'})`;
      lines.push(
        [
          `<@${invitedBy.inviter_id}> · ${when(invitedBy.joined_at)}`,
          `Būsena: **${statusNote}**`,
          invitedBy.invite_code ? `Invite kodas: \`${invitedBy.invite_code}\`` : '',
        ]
          .filter(Boolean)
          .join('\n')
      );
    } else {
      lines.push(
        `_Pakvietėjas nežinomas · ${when(invitedBy.joined_at)} · ${invitedBy.invalid_reason || 'unknown_inviter'}_`
      );
    }

    lines.push('');
    lines.push(`**Ką pakvietė (${validTotal} galiojančių)**`);
    const validList = getInvitesByInviter(guildId, user.id, { limit: 50, status: 'valid' });
    if (validList.length === 0) {
      lines.push('_Galiojančių pakvietimų nėra._');
    } else {
      for (const row of validList) {
        const ts = Math.floor(row.joined_at / 1000);
        lines.push(`• <@${row.invitee_id}> · <t:${ts}:f> · <t:${ts}:R>`);
      }
      if (validTotal > validList.length) {
        lines.push(`_… ir dar ${validTotal - validList.length}._`);
      }
    }

    if (invalidTotal > 0) {
      lines.push('');
      lines.push(`**Neįskaityti pakvietimai (${invalidTotal})**`);
      const invalidList = getInvitesByInviter(guildId, user.id, { limit: 20, status: 'invalid' });
      for (const row of invalidList) {
        const ts = Math.floor(row.joined_at / 1000);
        lines.push(
          `• <@${row.invitee_id}> · <t:${ts}:d> · _${row.invalid_reason || '—'}_`
        );
      }
      if (invalidTotal > invalidList.length) {
        lines.push(`_… ir dar ${invalidTotal - invalidList.length}._`);
      }
    }
  }

  const viewLabel = USERSTATS_VIEWS[viewKey]?.label ?? 'Apžvalga';

  return {
    lines,
    titleBase: user.globalName || user.username,
    guildName: guild.name,
    view: viewKey,
    viewLabel,
  };
}

/**
 * Sukelia tekstą į puslapius (neviršyjant Discord aprašymo ribos).
 */
function splitLinesIntoPageDescriptions(lines) {
  const pages = [];
  let bucket = [];

  function flushBucket() {
    if (bucket.length === 0) return;
    pages.push(bucket.join('\n'));
    bucket = [];
  }

  for (let line of lines) {
    line = typeof line === 'string' ? line : String(line);

    while (line.length > DESC_CHAR_BUDGET) {
      flushBucket();
      pages.push(line.slice(0, DESC_CHAR_BUDGET));
      line = line.slice(DESC_CHAR_BUDGET);
    }
    if (!line.length) continue;

    const joined = [...bucket, line].join('\n');
    if (joined.length > DESC_CHAR_BUDGET && bucket.length > 0) {
      flushBucket();
    }

    bucket.push(line);
  }
  flushBucket();
  return pages.length ? pages : ['_Tuščia._'];
}

function buildPagedEmbeds(user, guild, memberMaybe, avatarUrl, view = 'overview') {
  let collected;
  try {
    collected = collectUserstatsLines(user, guild, memberMaybe, view);
  } catch (err) {
    console.error('[userStats] collectUserstatsLines:', err?.stack || err?.message || err);
    collected = {
      lines: [`Klaida kraunant duomenis: \`${String(err?.message || err).slice(0, 180)}\``],
      titleBase: user.globalName || user.username || 'Vartotojas',
      guildName: guild.name || 'Serveris',
      view: 'overview',
      viewLabel: 'Apžvalga',
    };
  }

  let descriptions = splitLinesIntoPageDescriptions(collected.lines);
  if (!descriptions.length) descriptions = ['_Duomenų nėra._'];

  const embeds = descriptions.map((desc, idx) => {
    let d = desc;
    if (d.length > 4000) d = `${d.slice(0, 3985)}\n…`;

    const e = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`Nario statistika — ${collected.titleBase}`)
      .setDescription(d)
      .setTimestamp()
      .setFooter({
        text: `${collected.guildName} · ${collected.viewLabel} · staff · ${idx + 1}/${descriptions.length}`,
      });
    if (idx === 0) e.setThumbnail(avatarUrl || user.displayAvatarURL({ size: 128 }));
    return e;
  });
  return { embeds, pageCount: embeds.length, view: collected.view };
}

function pagingRowButtons(guildId, targetUserId, view, pageZeroBased, totalPages) {
  const row = new ActionRowBuilder();
  const safeTotal = Math.max(1, totalPages);
  const atFirst = pageZeroBased <= 0;
  const atLast = pageZeroBased >= safeTotal - 1;
  const noPages = safeTotal <= 1;
  const safeView = USERSTATS_VIEWS[view] ? view : 'overview';

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(
        `${PREFIX}|prev|${guildId}|${targetUserId}|${safeView}|${Math.max(0, pageZeroBased - 1)}`
      )
      .setLabel('«')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atFirst || noPages),
    new ButtonBuilder()
      .setCustomId(
        `${PREFIX}|next|${guildId}|${targetUserId}|${safeView}|${Math.min(safeTotal - 1, pageZeroBased + 1)}`
      )
      .setLabel('»')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atLast || noPages)
  );

  return row;
}

function viewSelectRow(guildId, targetUserId, currentView) {
  const safeView = USERSTATS_VIEWS[currentView] ? currentView : 'overview';
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}|select|${guildId}|${targetUserId}`)
    .setPlaceholder('Pasirink skiltį…')
    .addOptions(
      Object.entries(USERSTATS_VIEWS).map(([value, meta]) => ({
        label: meta.label,
        description: meta.description.slice(0, 100),
        value,
        default: value === safeView,
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

/**
 * Reply payload (/admin userstats atsako viešai kanale).
 */
function buildInitialUserstatsReply(user, guild, memberMaybe, view = 'overview', pageZeroBased = 0) {
  const avatarUrl = user.displayAvatarURL({ size: 128 });
  const safeView = USERSTATS_VIEWS[view] ? view : 'overview';
  const { embeds, pageCount } = buildPagedEmbeds(user, guild, memberMaybe, avatarUrl, safeView);

  if (!embeds.length) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('Statistika')
          .setDescription('Nepavyko sugeneruoti statistikos.'),
      ],
      components: [],
    };
  }

  const p = Math.max(0, Math.min(pageZeroBased, embeds.length - 1));

  return withAllowedMentions({
    embeds: [embeds[p]],
    components: [
      viewSelectRow(guild.id, user.id, safeView),
      pagingRowButtons(guild.id, user.id, safeView, p, pageCount),
    ],
  });
}

async function updateUserstatsMessage(interaction, targetUserId, view, pageRaw) {
  const user = await interaction.client.users.fetch(targetUserId).catch(() => null);
  if (!user) {
    return interaction.reply({ content: 'Vartotojo nerasta.', ephemeral: true });
  }

  const member = await interaction.guild.members.fetch(targetUserId).catch(() => null);
  const safeView = USERSTATS_VIEWS[view] ? view : 'overview';
  const { embeds: allEmbeds, pageCount } = buildPagedEmbeds(
    user,
    interaction.guild,
    member,
    user.displayAvatarURL({ size: 128 }),
    safeView
  );

  if (!allEmbeds.length) {
    try {
      await interaction.update(
        withAllowedMentions({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setDescription('Nepavyko užkrauti statistikos.'),
          ],
          components: [],
        })
      );
    } catch (_) {
      /* */
    }
    return;
  }

  const p = Math.max(0, Math.min(pageRaw, pageCount - 1));
  await interaction.update(
    withAllowedMentions({
      embeds: [allEmbeds[p]],
      components: [
        viewSelectRow(interaction.guildId, targetUserId, safeView),
        pagingRowButtons(interaction.guildId, targetUserId, safeView, p, pageCount),
      ],
    })
  );
}

async function handleUserstatsPageButton(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      content: 'Šiai komandai reikalingas serveris.',
      ephemeral: true,
    });
  }
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Nepakanka teisių.',
      ephemeral: true,
    });
  }

  const parts = interaction.customId.split('|');
  if (parts.length !== 6 || parts[0] !== PREFIX || (parts[1] !== 'prev' && parts[1] !== 'next')) {
    return;
  }

  const guildId = parts[2];
  const targetUserId = parts[3];
  const view = parts[4];
  const pageRaw = parseInt(parts[5], 10);

  if (guildId !== interaction.guildId || Number.isNaN(pageRaw)) {
    return interaction.reply({
      content: 'Netikslus mygtuko kontekstas.',
      ephemeral: true,
    });
  }

  try {
    await updateUserstatsMessage(interaction, targetUserId, view, pageRaw);
  } catch (e) {
    console.error('[userstats] pager:', e?.message || e);
    await interaction
      .followUp({
        content: 'Nepavyko puslapį atnaujinti.',
        ephemeral: true,
      })
      .catch(() => {});
  }
}

async function handleUserstatsViewSelect(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      content: 'Šiai komandai reikalingas serveris.',
      ephemeral: true,
    });
  }
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Nepakanka teisių.',
      ephemeral: true,
    });
  }

  const parts = interaction.customId.split('|');
  if (parts.length !== 4 || parts[0] !== PREFIX || parts[1] !== 'select') {
    return;
  }

  const guildId = parts[2];
  const targetUserId = parts[3];
  const view = interaction.values?.[0];

  if (guildId !== interaction.guildId || !USERSTATS_VIEWS[view]) {
    return interaction.reply({
      content: 'Netikslus meniu kontekstas.',
      ephemeral: true,
    });
  }

  try {
    await updateUserstatsMessage(interaction, targetUserId, view, 0);
  } catch (e) {
    console.error('[userstats] view select:', e?.message || e);
    await interaction
      .followUp({
        content: 'Nepavyko atnaujinti skilties.',
        ephemeral: true,
      })
      .catch(() => {});
  }
}

module.exports = {
  logGuildMemberEvent,
  buildInitialUserstatsReply,
  handleUserstatsPageButton,
  handleUserstatsViewSelect,
};
