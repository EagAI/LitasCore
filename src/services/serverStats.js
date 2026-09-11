const { EmbedBuilder } = require('discord.js');
const { withAllowedMentions } = require('../utils/allowedMentions');
const { countTimeoutsInRange } = require('./timeoutHistory');
const { countModInRange } = require('./modHistory');
const {
  vilniusDateString,
  shiftDay,
  dayRangeMs,
  periodTotals,
  countMembersWithLevels,
  trackingSinceDay,
  countMemberEvents,
} = require('./xpDaily');

function fmtInt(n) {
  return Math.round(Number(n) || 0).toLocaleString('lt-LT');
}

function fmtAvg(n, digits = 1) {
  const x = Number(n);
  if (!Number.isFinite(x) || x === 0) return '0';
  return x.toLocaleString('lt-LT', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function fmtDelta(n) {
  const v = Math.round(Number(n) || 0);
  if (v > 0) return `+${fmtInt(v)}`;
  if (v < 0) return `-${fmtInt(Math.abs(v))}`;
  return '0';
}

function fmtCount(stat) {
  const count = Number(stat?.count) || 0;
  const unique = Number(stat?.unique) || 0;
  if (unique > 0 && unique !== count) {
    return `**${fmtInt(count)}** (${fmtInt(unique)} unikalūs)`;
  }
  return `**${fmtInt(count)}**`;
}

function periodBundle(guildId, fromDay, toDay) {
  const { fromMs, toMs } = dayRangeMs(fromDay, toDay);
  const joins = countMemberEvents(guildId, 'join', fromMs, toMs);
  const leaves = countMemberEvents(guildId, 'leave', fromMs, toMs);
  return {
    joins,
    leaves,
    net: joins.count - leaves.count,
    timeouts: countTimeoutsInRange(guildId, fromMs, toMs),
    bans: countModInRange(guildId, 'ban', fromMs, toMs),
    unbans: countModInRange(guildId, 'unban', fromMs, toMs),
    kicks: countModInRange(guildId, 'kick', fromMs, toMs),
    xp: periodTotals(guildId, fromDay, toDay),
  };
}

function periodFieldValue(bundle, { prevNet } = {}) {
  const lines = [
    `Atejo ${fmtCount(bundle.joins)} · Išėjo ${fmtCount(bundle.leaves)}`,
    `Pokytis **${fmtDelta(bundle.net)}** narių`,
  ];
  if (prevNet != null && Number.isFinite(prevNet)) {
    lines.push(`Praėjęs toks pat periodas: **${fmtDelta(prevNet)}**`);
  }
  lines.push(
    `Timeout ${fmtCount(bundle.timeouts)} · Banai ${fmtCount(bundle.bans)}`,
    `Kickai ${fmtCount(bundle.kicks)} · Unban ${fmtCount(bundle.unbans)}`,
    `XP **${fmtInt(bundle.xp.xp)}** · lyg. **${fmtInt(bundle.xp.levels)}** · aktyvūs **${fmtInt(bundle.xp.users)}**`
  );
  return lines.join('\n');
}

function tempoBlock(xpPerDay, levelsPerDay) {
  return [
    `dieną: **${fmtAvg(xpPerDay, 1)}** XP · **${fmtAvg(levelsPerDay, 2)}** lyg.`,
    `savaitę: **${fmtAvg(xpPerDay * 7, 1)}** XP · **${fmtAvg(levelsPerDay * 7, 2)}** lyg.`,
    `mėnesį: **${fmtAvg(xpPerDay * 30, 1)}** XP · **${fmtAvg(levelsPerDay * 30, 2)}** lyg.`,
  ].join('\n');
}

function buildServerStatsReply(guild) {
  const guildId = guild.id;
  const today = vilniusDateString();
  const day7 = shiftDay(today, -6);
  const day30 = shiftDay(today, -29);
  const prev7from = shiftDay(today, -13);
  const prev7to = shiftDay(today, -7);
  const prev30from = shiftDay(today, -59);
  const prev30to = shiftDay(today, -30);

  const todayB = periodBundle(guildId, today, today);
  const weekB = periodBundle(guildId, day7, today);
  const monthB = periodBundle(guildId, day30, today);
  const prevWeekB = periodBundle(guildId, prev7from, prev7to);
  const prevMonthB = periodBundle(guildId, prev30from, prev30to);

  const roster = countMembersWithLevels(guildId);
  const since = trackingSinceDay(guildId);
  const membersNow = guild.memberCount ?? 0;

  const weekDays = 7;
  const xpPerActiveDay = weekB.xp.user_days ? weekB.xp.xp / weekB.xp.user_days : 0;
  const levelsPerActiveDay = weekB.xp.user_days ? weekB.xp.levels / weekB.xp.user_days : 0;
  const xpPerRosterDay = roster ? weekB.xp.xp / roster / weekDays : 0;
  const levelsPerRosterDay = roster ? weekB.xp.levels / roster / weekDays : 0;

  const monthXpPerActive = monthB.xp.user_days ? monthB.xp.xp / monthB.xp.user_days : 0;
  const monthLevelsPerActive = monthB.xp.user_days ? monthB.xp.levels / monthB.xp.user_days : 0;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Statistika — ${guild.name || 'Serveris'}`)
    .setDescription(
      [
        `Dabar narių: **${fmtInt(membersNow)}**`,
        `_Kalendorius: Europe/Vilnius._`,
        `_Timeout, banai ir kickai pildosi nuo dabar. Atejo / išėjo — pagal jau saugomą kroniką._`,
        since
          ? `_XP tempas sekamas nuo **${since}**._`
          : `_XP tempas pildysis, kai nariai gaus XP._`,
      ].join('\n')
    )
    .addFields(
      {
        name: `Šiandien (${today})`,
        value: periodFieldValue(todayB),
      },
      {
        name: 'Paskutinės 7 dienos',
        value: periodFieldValue(weekB, { prevNet: prevWeekB.net }),
      },
      {
        name: 'Paskutinės 30 dienų',
        value: periodFieldValue(monthB, { prevNet: prevMonthB.net }),
      },
      {
        name: 'Vid. aktyvus narys (pagal 7 d.)',
        value: tempoBlock(xpPerActiveDay, levelsPerActiveDay),
        inline: true,
      },
      {
        name: `Tarp visų su XP (${fmtInt(roster)})`,
        value: tempoBlock(xpPerRosterDay, levelsPerRosterDay),
        inline: true,
      },
      {
        name: 'Vid. aktyvus narys (pagal 30 d.)',
        value: tempoBlock(monthXpPerActive, monthLevelsPerActive),
      }
    )
    .setTimestamp()
    .setFooter({ text: 'Staff · /admin stats' });

  return withAllowedMentions({ embeds: [embed] });
}

module.exports = { buildServerStatsReply };
