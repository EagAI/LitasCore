const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const db = require('../db');
const config = require('../config');
const { isStaff } = require('../utils/permissions');
const { removeXp } = require('./levels');
const { withAllowedMentions } = require('../utils/allowedMentions');
const { pickRandomQuestions, isAnswerCorrect } = require('./jailQuestions');

const SLAP_GIF_URL = 'https://klipy.com/gifs/slap-13622';
const SLAP_TIMEOUT_MS = 5 * 60 * 1000;
const SLAP_XP_PENALTY = 1000;

function isTagAttempt(message) {
  if (message.mentions.everyone) return true;
  if (message.mentions.users.size > 0) return true;
  if (message.mentions.roles.size > 0) return true;
  if (message.mentions.channels.size > 0) return true;
  const content = message.content || '';
  if (/@everyone\b|@here\b/i.test(content)) return true;
  if (/@\S+/i.test(content)) return true;
  if (/<@!?\d+>|<@&\d+>/i.test(content)) return true;
  return false;
}

function getActiveJailSession(guildId, userId) {
  try {
    return db
      .prepare('SELECT * FROM jail_sessions WHERE guild_id = ? AND user_id = ? AND status = ?')
      .get(guildId, userId, 'active');
  } catch (_) {
    return null;
  }
}

function getJailSessionByChannel(channelId) {
  try {
    return db
      .prepare('SELECT * FROM jail_sessions WHERE channel_id = ? AND status = ?')
      .get(channelId, 'active');
  } catch (_) {
    return null;
  }
}

async function hideGuildChannelsForMember(guild, memberId, jailChannelId, jailCategoryId) {
  const hiddenChannelIds = [];
  const channels = await guild.channels.fetch().catch(() => guild.channels.cache);

  for (const [id, ch] of channels) {
    if (!ch) continue;
    if (id === jailChannelId) continue;
    if (id === jailCategoryId || ch.parentId === jailCategoryId) continue;
    if (typeof ch.isThread === 'function' && ch.isThread()) continue;

    try {
      await ch.permissionOverwrites.edit(
        memberId,
        { ViewChannel: false },
        { reason: 'Jail — paslėpti serverio kanalus' }
      );
      hiddenChannelIds.push(id);
    } catch (_) {
      /* ignore if bot lacks permission or channel cannot be edited */
    }
  }

  return hiddenChannelIds;
}

async function restoreGuildChannelsForMember(guild, memberId, hiddenChannelIds) {
  for (const chId of hiddenChannelIds) {
    const ch = guild.channels.cache.get(chId) || (await guild.channels.fetch(chId).catch(() => null));
    if (!ch) continue;
    try {
      await ch.permissionOverwrites.delete(memberId, 'Jail — atkurtos teisės');
    } catch (_) {
      /* ignore */
    }
  }
}

async function jailMember(interaction, targetUser, questionCount = 5) {
  if (!interaction.guild) {
    return interaction.reply({ content: 'Komanda veikia tik serveryje.', ephemeral: true });
  }

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    return interaction.reply({ content: 'Narys nerastas šiame serveryje.', ephemeral: true });
  }

  if (targetMember.user.bot) {
    return interaction.reply({ content: 'Negalima pasodinti boto į kalėjimą.', ephemeral: true });
  }

  if (targetMember.id === interaction.user.id) {
    return interaction.reply({ content: 'Negalima pasodinti savęs į kalėjimą.', ephemeral: true });
  }

  if (isStaff(targetMember)) {
    return interaction.reply({ content: 'Negalima pasodinti staff nario į kalėjimą.', ephemeral: true });
  }

  const active = getActiveJailSession(interaction.guild.id, targetMember.id);
  if (active) {
    return interaction.reply({
      content: `Šis narys jau yra kalėjime: <#${active.channel_id}>.`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  const categoryId = config.jailCategoryId || '1548398697577185421';
  let category = guild.channels.cache.get(categoryId);
  if (!category) {
    category = await guild.channels.fetch(categoryId).catch(() => null);
  }

  const cleanName =
    targetMember.user.username.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'narys';

  const overwrites = [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: targetMember.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    },
  ];

  for (const roleId of config.staffRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  let jailChannel;
  try {
    jailChannel = await guild.channels.create({
      name: `kalejimas-${cleanName}`,
      type: ChannelType.GuildText,
      parent: category ? category.id : null,
      permissionOverwrites: overwrites,
      topic: `Jail sesija — ${targetMember.user.tag} (${targetMember.id})`,
    });
  } catch (err) {
    console.error('[jail] create channel error:', err);
    return interaction.followUp({
      content: `Nepavyko sukurti kalėjimo kanalo: ${err?.message || err}`,
      ephemeral: true,
    });
  }

  const hiddenChannelIds = await hideGuildChannelsForMember(
    guild,
    targetMember.id,
    jailChannel.id,
    category?.id || categoryId
  );

  const pickedQuestions = pickRandomQuestions(questionCount || 5);

  db.prepare(`
    INSERT INTO jail_sessions (
      guild_id, user_id, channel_id, jailed_by, current_question_index, questions_data, hidden_channel_ids, created_at, status
    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, 'active')
  `).run(
    guild.id,
    targetMember.id,
    jailChannel.id,
    interaction.user.id,
    JSON.stringify(pickedQuestions),
    JSON.stringify(hiddenChannelIds),
    Date.now()
  );

  const introEmbed = new EmbedBuilder()
    .setTitle('🚨 Tu pasodintas į kalėjimą!')
    .setDescription(
      `Sveikas atvykęs į kalėjimą, ${targetMember}!\n\n` +
      `Tau apribota prieiga prie visų serverio kanalų. Norėdamas sugrįžti į serverį, privalai **teisingai atsakyti į visus ${pickedQuestions.length} klausimus**.\n\n` +
      `⚠️ **SVARBI TAISYKLĖ:** Jeigu bandysi @here, @everyone arba bet ką kitą **@ taginti** — gausi **slap**, **5 min. timeout** ir **-1 000 XP**!\n\n` +
      `Kiekvieną kartą neteisingai atsakius į klausimą, botas parašys „Bandyk dar kartą.“\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `**1/${pickedQuestions.length} Klausimas:**\n` +
      `👉 **${pickedQuestions[0].question}**`
    )
    .setColor(0xed4245)
    .setTimestamp();

  await jailChannel
    .send(withAllowedMentions({ content: `${targetMember}`, embeds: [introEmbed] }, { pingUsers: true }))
    .catch(() => {});

  const logChannel = guild.channels.cache.get(config.logChannelId);
  if (logChannel) {
    const logEmbed = new EmbedBuilder()
      .setTitle('🔒 Narys pasodintas į kalėjimą')
      .setColor(0xed4245)
      .addFields(
        { name: 'Narys', value: `${targetMember.user.tag} (<@${targetMember.id}>)`, inline: true },
        { name: 'Moderatorius', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
        { name: 'Kanalas', value: `<#${jailChannel.id}>`, inline: true },
        { name: 'Klausimų skaičius', value: `${pickedQuestions.length}`, inline: true }
      )
      .setTimestamp();
    await logChannel.send(withAllowedMentions({ embeds: [logEmbed] })).catch(() => {});
  }

  return interaction.followUp({
    content: `✅ ${targetMember} sėkmingai pasodintas į kalėjimą: <#${jailChannel.id}> (${pickedQuestions.length} klausimai). Visi kiti kanalai paslėpti.`,
    ephemeral: true,
  });
}

async function releaseFromJail(session, guild, reason = 'completed', memberMaybe = null) {
  let hiddenChannelIds = [];
  try {
    hiddenChannelIds = JSON.parse(session.hidden_channel_ids || '[]');
  } catch (_) {
    hiddenChannelIds = [];
  }

  await restoreGuildChannelsForMember(guild, session.user_id, hiddenChannelIds);

  db.prepare('UPDATE jail_sessions SET status = ? WHERE id = ?').run(reason, session.id);

  const jailChannel = guild.channels.cache.get(session.channel_id) ||
    (await guild.channels.fetch(session.channel_id).catch(() => null));

  if (jailChannel) {
    if (reason === 'completed') {
      await jailChannel
        .send('🎉 **Sveikinu!** Teisingai atsakei į visus klausimus.\nPrieiga prie serverio atkurta! Šis kanalas bus ištrintas po 6 sekundžių.')
        .catch(() => {});
      setTimeout(() => jailChannel.delete('Jail baigtas teisingai atsakius').catch(() => {}), 6000);
    } else {
      await jailChannel
        .send('🔓 Buvai išleistas iš kalėjimo moderatorius sprendimu. Šis kanalas bus ištrintas po 4 sekundžių.')
        .catch(() => {});
      setTimeout(() => jailChannel.delete('Jail unjailed').catch(() => {}), 4000);
    }
  }

  const logChannel = guild.channels.cache.get(config.logChannelId);
  if (logChannel) {
    const logEmbed = new EmbedBuilder()
      .setTitle('🔓 Narys paleistas iš kalėjimo')
      .setColor(0x57f287)
      .addFields(
        { name: 'Narys', value: `<@${session.user_id}>`, inline: true },
        {
          name: 'Priežastis',
          value: reason === 'completed' ? 'Teisingai atsakė į visus klausimus' : 'Paleistas moderatoriaus rankiniu būdu',
          inline: true,
        }
      )
      .setTimestamp();
    await logChannel.send(withAllowedMentions({ embeds: [logEmbed] })).catch(() => {});
  }
}

async function unjailMember(interaction, targetUser) {
  if (!interaction.guild) {
    return interaction.reply({ content: 'Komanda veikia tik serveryje.', ephemeral: true });
  }

  const active = getActiveJailSession(interaction.guild.id, targetUser.id);
  if (!active) {
    return interaction.reply({ content: 'Šis narys šiuo metu nėra kalėjime.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  await releaseFromJail(active, interaction.guild, 'released');

  return interaction.followUp({
    content: `✅ <@${targetUser.id}> sėkmingai paleistas iš kalėjimo, visi kanalai atkurti.`,
    ephemeral: true,
  });
}

async function handleJailMessage(message) {
  if (!message.guild || message.author.bot) return false;

  const session = getJailSessionByChannel(message.channel.id);
  if (!session) return false;

  // Tik kalinio žinutės skaitomos kaip atsakymai ar baudžiamas taginimas
  if (message.author.id !== session.user_id) return false;

  // 1. Tikrinam ar bando taginti (@here, @everyone, vartotojus, roles)
  if (isTagAttempt(message)) {
    try {
      await message.reply({ content: SLAP_GIF_URL }).catch(() => {});

      if (message.member?.moderatable) {
        await message.member.timeout(SLAP_TIMEOUT_MS, 'Jail — bandymas taginti').catch(() => {});
      }

      await removeXp(message.member, SLAP_XP_PENALTY).catch(() => {});

      await message.channel
        .send(withAllowedMentions({ content: `${message.author}, tu neturi teisės taginti -1k.` }, { pingUsers: true }))
        .catch(() => {});
    } catch (e) {
      console.error('[jail tag penalty error]', e);
    }
    return true;
  }

  // 2. Tikrinam klausimo atsakymą
  let questions = [];
  try {
    questions = JSON.parse(session.questions_data);
  } catch (_) {
    questions = [];
  }

  if (!questions.length) return false;

  const currentIndex = session.current_question_index;
  const currentQ = questions[currentIndex];
  if (!currentQ) return false;

  const correct = isAnswerCorrect(message.content, currentQ.answers);

  if (!correct) {
    await message.reply('Bandyk dar kartą.').catch(() => {});
    return true;
  }

  const nextIndex = currentIndex + 1;

  if (nextIndex < questions.length) {
    db.prepare('UPDATE jail_sessions SET current_question_index = ? WHERE id = ?').run(
      nextIndex,
      session.id
    );

    const nextQ = questions[nextIndex];
    await message
      .reply({
        content: `✅ Teisingai!\n\n**${nextIndex + 1}/${questions.length} Klausimas:**\n👉 **${nextQ.question}**`,
      })
      .catch(() => {});
    return true;
  }

  // Visi klausimai atsakyti teisingai!
  await releaseFromJail(session, message.guild, 'completed', message.member);
  return true;
}

async function handleJailMemberRejoin(member) {
  const active = getActiveJailSession(member.guild.id, member.id);
  if (!active) return;

  const categoryId = config.jailCategoryId || '1548398697577185421';
  const hiddenChannelIds = await hideGuildChannelsForMember(
    member.guild,
    member.id,
    active.channel_id,
    categoryId
  );

  db.prepare('UPDATE jail_sessions SET hidden_channel_ids = ? WHERE id = ?').run(
    JSON.stringify(hiddenChannelIds),
    active.id
  );

  const jailChannel = member.guild.channels.cache.get(active.channel_id);
  if (jailChannel) {
    await jailChannel.permissionOverwrites
      .edit(member.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      })
      .catch(() => {});
  }
}

module.exports = {
  jailMember,
  unjailMember,
  handleJailMessage,
  handleJailMemberRejoin,
  getActiveJailSession,
};
