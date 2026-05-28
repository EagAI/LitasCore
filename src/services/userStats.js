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
const { resolveUserLabelMap, userLabel } = require('../utils/userDisplay');

const PREFIX = 'usrst';
/** description max ~ Discord 4096; paliekam vietos footer puslapiui */
const DESC_CHAR_BUDGET = 3800;
/** Pakvietimų sąraše viename puslapyje */
const INVITES_PER_PAGE = 5;

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

function whenDate(atMs) {
  const u = Math.floor(Number(atMs) / 1000);
  if (!Number.isFinite(u)) return '—';
  return `<t:${u}:f>`;
}

/** Grąžina eilutes pagal pasirinktą skiltį. */
async function collectUserstatsLines(user, guild, memberMaybe, view = 'overview') {
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

  const viewLabel = USERSTATS_VIEWS[viewKey]?.label ?? 'Apžvalga';

  return {
    lines,
    titleBase: user.globalName || user.username,
    guildName: guild.name,
    view: viewKey,
    viewLabel,
  };
}

function loadInviteListData(guildId, userId) {
  const inviteStats = getInviteStats(userId, guildId);
  const validTotal = countInvitesByInviter(guildId, userId, 'valid');
  const invalidTotal = countInvitesByInviter(guildId, userId, 'invalid');
  const validList =
    validTotal > 0
      ? getInvitesByInviter(guildId, userId, { limit: validTotal, status: 'valid' })
      : [];
  const invalidList =
    invalidTotal > 0
      ? getInvitesByInviter(guildId, userId, { limit: invalidTotal, status: 'invalid' })
      : [];
  const allItems = [
    ...validList.map(row => ({ kind: 'valid', row })),
    ...invalidList.map(row => ({ kind: 'invalid', row })),
  ];

  return {
    inviteStats,
    validTotal,
    invalidTotal,
    validList,
    invalidList,
    allItems,
    invitedBy: getInviteRecordForInvitee(guildId, userId),
  };
}

function countInvitesPages(allItems) {
  if (!allItems.length) return 1;
  return Math.ceil(allItems.length / INVITES_PER_PAGE);
}

async function collectInvitesPageLines(user, guild, pageZeroBased) {
  const guildId = guild.id;
  const { inviteStats, validTotal, invalidTotal, allItems, invitedBy } = loadInviteListData(
    guildId,
    user.id
  );
  const pageCount = countInvitesPages(allItems);
  const page = Math.max(0, Math.min(pageZeroBased, pageCount - 1));
  const start = page * INVITES_PER_PAGE;
  const slice = allItems.slice(start, start + INVITES_PER_PAGE);

  const labelIds = [];
  if (page === 0 && invitedBy?.inviter_id) labelIds.push(invitedBy.inviter_id);
  for (const item of slice) labelIds.push(item.row.invitee_id);
  const inviteLabels = await resolveUserLabelMap(guild, labelIds, guild.client);

  const lines = [];
  const sinceTs = Math.floor(getTrackingSince() / 1000);

  if (page === 0) {
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
        '',
        '**Kas pakvietė šį narį**',
      ].join('\n')
    );

    if (!invitedBy) {
      lines.push('_Nėra įrašo (prisijungė prieš sekimo pradžią arba ne per invite)._');
    } else if (invitedBy.inviter_id) {
      const statusNote =
        invitedBy.status === 'valid'
          ? 'galiojantis'
          : `neįskaitytas (${invitedBy.invalid_reason || '—'})`;
      lines.push(
        [
          `${userLabel(inviteLabels, invitedBy.inviter_id)} · ${whenDate(invitedBy.joined_at)}`,
          `Būsena: **${statusNote}**`,
          invitedBy.invite_code ? `Invite kodas: \`${invitedBy.invite_code}\`` : '',
        ]
          .filter(Boolean)
          .join('\n')
      );
    } else {
      lines.push(
        `_Pakvietėjas nežinomas · ${whenDate(invitedBy.joined_at)} · ${invitedBy.invalid_reason || 'unknown_inviter'}_`
      );
    }
  } else {
    lines.push(`**Pakvietimai** · _puslapis ${page + 1}/${pageCount}_`);
  }

  if (slice.length === 0) {
    if (page === 0) {
      lines.push('');
      lines.push('_Pakviestų narių sąraše nieko nėra._');
    }
  } else {
    let prevKind = start > 0 ? allItems[start - 1].kind : null;
    for (const item of slice) {
      if (item.kind === 'valid' && prevKind !== 'valid') {
        lines.push('');
        lines.push(`**Ką pakvietė (${validTotal} galiojančių)**`);
      }
      if (item.kind === 'invalid' && prevKind !== 'invalid') {
        lines.push('');
        lines.push(`**Neįskaityti pakvietimai (${invalidTotal})**`);
      }
      prevKind = item.kind;

      const ts = Math.floor(item.row.joined_at / 1000);
      if (item.kind === 'valid') {
        lines.push(
          `• ${userLabel(inviteLabels, item.row.invitee_id)} · <t:${ts}:f>`
        );
      } else {
        lines.push(
          `• ${userLabel(inviteLabels, item.row.invitee_id)} · <t:${ts}:f> · _${item.row.invalid_reason || '—'}_`
        );
      }
    }
  }

  return {
    lines,
    titleBase: user.globalName || user.username,
    guildName: guild.name,
    view: 'invites',
    viewLabel: USERSTATS_VIEWS.invites.label,
    pageCount,
    page,
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

async function buildPagedEmbeds(user, guild, memberMaybe, avatarUrl, view = 'overview', pageZeroBased = 0) {
  const safeView = USERSTATS_VIEWS[view] ? view : 'overview';

  if (safeView === 'invites') {
    let collected;
    try {
      collected = await collectInvitesPageLines(user, guild, pageZeroBased);
    } catch (err) {
      console.error('[userStats] collectInvitesPageLines:', err?.stack || err?.message || err);
      collected = {
        lines: [`Klaida kraunant pakvietimus: \`${String(err?.message || err).slice(0, 180)}\``],
        titleBase: user.globalName || user.username || 'Vartotojas',
        guildName: guild.name || 'Serveris',
        view: 'invites',
        viewLabel: USERSTATS_VIEWS.invites.label,
        pageCount: 1,
        page: 0,
      };
    }

    const desc = collected.lines.join('\n').slice(0, 4000);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`Nario statistika — ${collected.titleBase}`)
      .setDescription(desc || '_Tuščia._')
      .setTimestamp()
      .setFooter({
        text: `${collected.guildName} · ${collected.viewLabel} · staff · ${collected.page + 1}/${collected.pageCount}`,
      })
      .setThumbnail(avatarUrl || user.displayAvatarURL({ size: 128 }));

    return { embeds: [embed], pageCount: collected.pageCount, view: 'invites' };
  }

  let collected;
  try {
    collected = await collectUserstatsLines(user, guild, memberMaybe, safeView);
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
async function buildInitialUserstatsReply(user, guild, memberMaybe, view = 'overview', pageZeroBased = 0) {
  const avatarUrl = user.displayAvatarURL({ size: 128 });
  const safeView = USERSTATS_VIEWS[view] ? view : 'overview';
  const { embeds, pageCount } = await buildPagedEmbeds(
    user,
    guild,
    memberMaybe,
    avatarUrl,
    safeView,
    pageZeroBased
  );

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

  const p = Math.max(0, Math.min(pageZeroBased, pageCount - 1));
  const displayEmbed = safeView === 'invites' ? embeds[0] : embeds[p];

  return withAllowedMentions({
    embeds: [displayEmbed],
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
  const p = Math.max(0, pageRaw);
  const { embeds: allEmbeds, pageCount } = await buildPagedEmbeds(
    user,
    interaction.guild,
    member,
    user.displayAvatarURL({ size: 128 }),
    safeView,
    p
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

  const safePage = Math.max(0, Math.min(p, pageCount - 1));
  await interaction.update(
    withAllowedMentions({
      embeds: [allEmbeds[safeView === 'invites' ? 0 : safePage]],
      components: [
        viewSelectRow(interaction.guildId, targetUserId, safeView),
        pagingRowButtons(interaction.guildId, targetUserId, safeView, safePage, pageCount),
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
