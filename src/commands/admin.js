const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  PollLayoutType,
  AttachmentBuilder,
} = require('discord.js');
const { isStaff } = require('../utils/permissions');

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
};

async function fetchImageAttachment(url, filename) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 16) throw new Error('per mažas failas');
  return new AttachmentBuilder(buf, { name: filename });
}
const { BADGES, BADGE_MAP, blacklistRoleId } = require('../config');
const { addBadge, removeBadge, getUserBadges } = require('../services/badges');
const { addBalance, removeBalance, getBalance } = require('../services/economy');
const {
  addXp,
  removeXp,
  afterXpGainAnnouncements,
  buildLevelCheckEmbed,
} = require('../services/levels');
const { buildInitialUserstatsReply } = require('../services/userStats');
const { adminUpsertLeaver, adminRemoveLeaver } = require('../services/guildLeavers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin komandos')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(sub =>
      sub
        .setName('say')
        .setDescription('Siųsti žinutę nurodytu kanalu')
        .addChannelOption(opt =>
          opt.setName('kanalas').setDescription('Tikslo kanalas').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('tekstas').setDescription('Žinutės turinys').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('embed')
        .setDescription('Siųsti embed')
        .addChannelOption(opt =>
          opt.setName('kanalas').setDescription('Tikslo kanalas').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('aprašymas').setDescription('Embed aprašymas').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('pavadinimas').setDescription('Embed pavadinimas (nebūtina)').setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('spalva').setDescription('Hex spalva, pvz. #5865F2')
        )
        .addStringOption(opt =>
          opt
            .setName('nuotrauka')
            .setDescription('Nuotrauka embede (image URL, viduje kortelės)')
            .setMaxLength(2000)
        )
        .addStringOption(opt =>
          opt
            .setName('taisykles')
            .setDescription('Papildomas tekstas lauke „Taisyklės“ (max ~1000 simb.)')
            .setMaxLength(2000)
        )
        .addStringOption(opt =>
          opt
            .setName('virs_nuotrauka')
            .setDescription('Atskiri priedo nuotr. virš embed (URL; rodoma viršutinėje dalyje)')
            .setMaxLength(2000)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('vote')
        .setDescription('Sukurti balsavimą')
        .addChannelOption(opt =>
          opt.setName('kanalas').setDescription('Tikslo kanalas').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('klausimas').setDescription('Balsavimo klausimas').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('variantas1').setDescription('1 variantas').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('variantas2').setDescription('2 variantas').setRequired(true)
        )
        .addStringOption(opt => opt.setName('variantas3').setDescription('3 variantas'))
        .addStringOption(opt => opt.setName('variantas4').setDescription('4 variantas'))
        .addStringOption(opt => opt.setName('variantas5').setDescription('5 variantas'))
        .addIntegerOption(opt =>
          opt.setName('trukme').setDescription('Trukmė valandomis (numatyta: 24)').setMinValue(1).setMaxValue(168)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('userstats')
        .setDescription('Detali nario statistika: istorija, laikas serveryje, lygiai…')
        .addUserOption(opt =>
          opt.setName('narys').setDescription('Vartotojas').setRequired(true)
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('badge')
        .setDescription('Ženklelių valdymas')
        .addSubcommand(sub =>
          sub
            .setName('add')
            .setDescription('Priskirti ženklelį nariui')
            .addUserOption(opt =>
              opt.setName('narys').setDescription('Narys').setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName('zenklelis')
                .setDescription('Ženklelis')
                .setRequired(true)
                .addChoices(...BADGES.map(b => ({ name: b.label, value: b.id })))
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('remove')
            .setDescription('Pašalinti ženklelį iš nario')
            .addUserOption(opt =>
              opt.setName('narys').setDescription('Narys').setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName('zenklelis')
                .setDescription('Ženklelis')
                .setRequired(true)
                .addChoices(...BADGES.map(b => ({ name: b.label, value: b.id })))
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('list')
            .setDescription('Parodyti nario ženklelius arba visų galimų sąrašą')
            .addUserOption(opt =>
              opt.setName('narys').setDescription('Narys (neįvedus – rodomas katalogas)').setRequired(false)
            )
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('eco')
        .setDescription('Ekonomikos valdymas (litai)')
        .addSubcommand(sub =>
          sub
            .setName('add')
            .setDescription('Pridėti litų nariui')
            .addUserOption(opt =>
              opt.setName('narys').setDescription('Narys').setRequired(true)
            )
            .addIntegerOption(opt =>
              opt.setName('kiekis').setDescription('Kiek litų pridėti').setRequired(true).setMinValue(1)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('remove')
            .setDescription('Atimti litus iš nario')
            .addUserOption(opt =>
              opt.setName('narys').setDescription('Narys').setRequired(true)
            )
            .addIntegerOption(opt =>
              opt.setName('kiekis').setDescription('Kiek litų atimti').setRequired(true).setMinValue(1)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('balance')
            .setDescription('Peržiūrėti nario litų balansą')
            .addUserOption(opt =>
              opt.setName('narys').setDescription('Vartotojas').setRequired(true)
            )
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('levels')
        .setDescription('Lygių ir XP valdymas')
        .addSubcommand(sub =>
          sub
            .setName('add')
            .setDescription('Pridėti XP nariui')
            .addUserOption(opt =>
              opt.setName('narys').setDescription('Narys').setRequired(true)
            )
            .addIntegerOption(opt =>
              opt.setName('xp').setDescription('Kiek XP pridėti').setRequired(true).setMinValue(1).setMaxValue(50_000_000)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('remove')
            .setDescription('Atimti XP iš nario')
            .addUserOption(opt =>
              opt.setName('narys').setDescription('Narys').setRequired(true)
            )
            .addIntegerOption(opt =>
              opt.setName('xp').setDescription('Kiek XP atimti').setRequired(true).setMinValue(1).setMaxValue(50_000_000)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('check')
            .setDescription('Parodyti nario lygį ir XP')
            .addUserOption(opt =>
              opt.setName('narys').setDescription('Vartotojas').setRequired(true)
            )
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('blacklist')
        .setDescription('Išėjikų sąrašo valdymas (DB + giveaway taisyklės)')
        .addSubcommand(sub =>
          sub
            .setName('add')
            .setDescription('Pridėti narį į išėjikų sąrašą')
            .addUserOption(opt =>
              opt.setName('narys').setDescription('Narys').setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName('priezastis')
                .setDescription('Priežastis (nebūtina)')
                .setRequired(false)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('remove')
            .setDescription('Pašalinti narį iš išėjikų sąrašo')
            .addUserOption(opt =>
              opt.setName('narys').setDescription('Narys').setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName('priezastis')
                .setDescription('Komentaras atsakyme (nebūtina, nelaikoma DB)')
                .setRequired(false)
            )
        )
    ),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: 'Nepakanka teisių.', ephemeral: true });
    }

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (!group && sub === 'userstats') {
      if (!interaction.guild || !interaction.member) {
        return interaction.reply({
          content: 'Komanda galima tik serveryje (kaip narį).',
          ephemeral: true,
        });
      }
      const user = interaction.options.getUser('narys', true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      try {
        return await interaction.reply({
          ...buildInitialUserstatsReply(user, interaction.guild, member),
        });
      } catch (err) {
        console.error('[admin userstats]', err?.stack || err?.message || err);
        const body = {
          content: `Klaida: ${String(err?.message || err).slice(0, 260)}`,
          ephemeral: true,
        };
        if (interaction.deferred || interaction.replied) {
          return interaction.followUp(body).catch(() => {});
        }
        return interaction.reply(body).catch(() => {});
      }
    }

    if (group === 'badge') {
      if (sub === 'add') {
        const target = interaction.options.getMember('narys');
        const badgeId = interaction.options.getString('zenklelis');
        const badge = BADGE_MAP[badgeId];
        const ok = addBadge(target.id, interaction.guildId, badgeId, interaction.user.id);
        if (!ok) {
          return interaction.reply({
            content: `${target} jau turi ženklelį ${badge.emoji} **${badge.label}**.`,
            ephemeral: true,
          });
        }
        return interaction.reply({
          content: `${badge.emoji} **${badge.label}** ženklelis priskirtas ${target}.`,
          ephemeral: true,
        });
      }

      if (sub === 'remove') {
        const target = interaction.options.getMember('narys');
        const badgeId = interaction.options.getString('zenklelis');
        const badge = BADGE_MAP[badgeId];
        const ok = removeBadge(target.id, interaction.guildId, badgeId);
        if (!ok) {
          return interaction.reply({
            content: `${target} neturi ženklelio **${badge.label}**.`,
            ephemeral: true,
          });
        }
        return interaction.reply({
          content: `${badge.emoji} **${badge.label}** ženklelis pašalintas iš ${target}.`,
          ephemeral: true,
        });
      }

      if (sub === 'list') {
        const target = interaction.options.getMember('narys');
        if (target) {
          const ids = getUserBadges(target.id, interaction.guildId);
          if (ids.length === 0) {
            return interaction.reply({
              content: `${target} neturi jokių ženklelių.`,
              ephemeral: true,
            });
          }
          const lines = ids.map(id => {
            const b = BADGE_MAP[id];
            return b ? `${b.emoji} ${b.label}` : id;
          });
          return interaction.reply({
            content: `**${target.displayName}** ženkleliai:\n${lines.join('\n')}`,
            ephemeral: true,
          });
        }
        const catalog = BADGES.map(b => `${b.emoji} **${b.label}** (\`${b.id}\`)`).join('\n');
        return interaction.reply({ content: `**Galimi ženkleliai:**\n${catalog}`, ephemeral: true });
      }
    }

    if (group === 'eco') {
      if (sub === 'balance') {
        const user = interaction.options.getUser('narys', true);
        const bal = getBalance(user.id, interaction.guildId);
        return interaction.reply({
          content: `${user}: **${bal.toLocaleString('lt-LT')} Lt**.`,
          ephemeral: true,
        });
      }

      const target = interaction.options.getMember('narys');
      const amount = interaction.options.getInteger('kiekis');

      if (sub === 'add') {
        const newBal = addBalance(target.id, interaction.guildId, amount);
        return interaction.reply({
          content: `✅ **${target.displayName}** gavo **${amount} Lt**. Balansas: **${newBal} Lt**.`,
          ephemeral: true,
        });
      }

      if (sub === 'remove') {
        const newBal = removeBalance(target.id, interaction.guildId, amount);
        return interaction.reply({
          content: `✅ Iš **${target.displayName}** atimta **${amount} Lt**. Balansas: **${newBal} Lt**.`,
          ephemeral: true,
        });
      }
    }

    if (group === 'levels') {
      const user = interaction.options.getUser('narys', true);
      const guildId = interaction.guildId;

      if (sub === 'check') {
        const embed = buildLevelCheckEmbed(user, guildId);
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        return interaction.reply({
          content: 'Nario nerasta šiame serveryje.',
          ephemeral: true,
        });
      }

      const xpAmt = interaction.options.getInteger('xp');

      if (sub === 'add') {
        const result = await addXp(member, xpAmt);
        await afterXpGainAnnouncements(member, result);
        return interaction.reply({
          content:
            `**+${xpAmt.toLocaleString('lt-LT')} XP** — ${member}\n` +
            `Lygis **${result.newLevel}**, XP **${result.newXp.toLocaleString('lt-LT')}**.`,
          ephemeral: true,
        });
      }

      if (sub === 'remove') {
        const out = await removeXp(member, xpAmt);
        return interaction.reply({
          content:
            `**-${xpAmt.toLocaleString('lt-LT')} XP** (${member})\n` +
            `Lygis **${out.newLevel}**, XP **${out.newXp.toLocaleString('lt-LT')}** (buvo ${out.oldLevel} / ${out.oldXp.toLocaleString('lt-LT')}).`,
          ephemeral: true,
        });
      }
    }

    if (group === 'blacklist') {
      if (!interaction.guild) {
        return interaction.reply({ content: 'Tik serveryje.', ephemeral: true });
      }
      const user = interaction.options.getUser('narys', true);
      const priez = interaction.options.getString('priezastis')?.trim() || null;
      const guildId = interaction.guildId;
      const label = user.displayName;

      if (sub === 'add') {
        adminUpsertLeaver(guildId, user.id, priez);
        const roleParts = [];
        if (blacklistRoleId) {
          const m = await interaction.guild.members.fetch(user.id).catch(() => null);
          if (m) {
            try {
              await m.roles.add(blacklistRoleId);
              roleParts.push('Blacklist rolė priskyta.');
            } catch (e) {
              roleParts.push(
                `Rolės priskirti nepavyko: ${String(e?.message || e).slice(0, 100)}.`
              );
            }
          } else {
            roleParts.push('Narys nėra serveryje — įrašas DB; rolė priskyta prisijungus.');
          }
        } else {
          roleParts.push('BLACKLIST_ROLE_ID nenustatytas .env — įrašas DB, jokia rolė nepriskirta.');
        }
        const p = priez ? `Priežastis: **${priez}**. ` : '';
        return interaction.reply({
          content: `Įtrauktas **${label}** į išėjikų sąrašą. ${p}${roleParts.join(' ')}`.trim(),
          ephemeral: true,
        });
      }

      if (sub === 'remove') {
        const del = adminRemoveLeaver(guildId, user.id);
        if (!del.changes) {
          return interaction.reply({
            content: `**${label}** nebuvo išėjikų sąraše.`,
            ephemeral: true,
          });
        }
        const post = [];
        if (blacklistRoleId) {
          const m = await interaction.guild.members.fetch(user.id).catch(() => null);
          if (m?.roles?.cache.has(blacklistRoleId)) {
            try {
              await m.roles.remove(blacklistRoleId);
              post.push('Blacklist rolė nuimta.');
            } catch (e) {
              post.push(
                `Rolės nuimti nepavyko: ${String(e?.message || e).slice(0, 100)}.`
              );
            }
          }
        }
        const p = priez ? `Komentaras: **${priez}**. ` : '';
        return interaction.reply({
          content: `**${label}** pašalintas iš išėjikų sąrašo. ${p}${post.join(' ')}`.trim(),
          ephemeral: true,
        });
      }
    }

    if (sub === 'say') {
      const channel = interaction.options.getChannel('kanalas');
      const text = interaction.options.getString('tekstas');
      await channel.send(text);
      return interaction.reply({ content: 'Žinutė išsiųsta.', ephemeral: true });
    }

    if (sub === 'embed') {
      const channel = interaction.options.getChannel('kanalas');
      const title = interaction.options.getString('pavadinimas');
      const description = interaction.options.getString('aprašymas');
      const colorStr = interaction.options.getString('spalva');
      const imageInEmbed = interaction.options.getString('nuotrauka');
      const taisykles = interaction.options.getString('taisykles');
      const imageAbove = interaction.options.getString('virs_nuotrauka');
      const colorInt = colorStr ? parseInt(colorStr.replace('#', ''), 16) : 0x5865f2;
      const color = isNaN(colorInt) ? 0x5865f2 : colorInt;

      const embed = new EmbedBuilder().setColor(color).setTimestamp();
      if (title?.trim()) embed.setTitle(title.trim());
      embed.setDescription(description);

      if (taisykles?.trim()) {
        const t = taisykles.trim();
        embed.addFields({
          name: '📜 Taisyklės',
          value: t.length > 1024 ? `${t.slice(0, 1020)}…` : t,
          inline: false,
        });
      }

      const files = [];
      const EMBED_IMAGE_NAME = 'e-embed-image.png';
      const VIRS_IMAGE_NAME = 'e-virs.png';

      if (imageAbove?.startsWith('http')) {
        try {
          const att = await fetchImageAttachment(imageAbove, VIRS_IMAGE_NAME);
          files.push(att);
        } catch (e) {
          console.error('[admin embed] virs_nuotrauka:', e?.message);
        }
      }
      if (imageInEmbed?.startsWith('http')) {
        try {
          const att = await fetchImageAttachment(imageInEmbed, EMBED_IMAGE_NAME);
          files.push(att);
          embed.setImage(`attachment://${EMBED_IMAGE_NAME}`);
        } catch (e) {
          console.error('[admin embed] nuotrauka (fetch):', e?.message);
          embed.setImage(imageInEmbed);
        }
      }

      const payload = { embeds: [embed] };
      if (files.length) payload.files = files;
      await channel.send(payload);
      return interaction.reply({ content: 'Embed išsiųstas.', ephemeral: true });
    }

    if (sub === 'vote') {
      const channel = interaction.options.getChannel('kanalas');
      const question = interaction.options.getString('klausimas');
      const duration = interaction.options.getInteger('trukme') ?? 24;
      const answers = [
        interaction.options.getString('variantas1'),
        interaction.options.getString('variantas2'),
        interaction.options.getString('variantas3'),
        interaction.options.getString('variantas4'),
        interaction.options.getString('variantas5'),
      ].filter(Boolean).map(text => ({ text }));

      await channel.send({
        poll: {
          question: { text: question },
          answers,
          duration,
          allowMultiselect: false,
          layoutType: PollLayoutType.Default,
        },
      });

      return interaction.reply({ content: 'Balsavimas sukurtas.', ephemeral: true });
    }
  },
};
