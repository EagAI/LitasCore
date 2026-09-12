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
const AUTO_DELETE_MS = 5000;

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

const jailUserMessageHistory = new Map();

function isRandomGibberish(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // 1. 5+ pasikartojančių tų pačių simbolių iš eilės (pvz. aaaaa, ddddd, .......)
  if (/(.)\1{4,}/i.test(trimmed)) return true;

  // 2. 6+ priebalsių iš eilės be balsių (pvz. sdfghj, qwrtyp)
  if (/[bcdfghjklmnpqrstvwxz]{6,}/i.test(trimmed)) return true;

  // 3. Klaviatūros eilių braukimas (asdf, qwer, zxcvb, asdasd) su ilgiu >= 4
  if (
    /(?:asdf|sdfg|dfgh|fghj|ghjk|hjkl|qwer|wert|erty|rtyu|tyui|uiop|zxcv|xcvb|cvbn|vbnm|asdasd)/i.test(
      trimmed
    ) &&
    trimmed.length >= 4
  ) {
    return true;
  }

  // 4. Žodis iš 5+ raidžių visiškai be balsių (pvz. fgjkl, sdfgh)
  const words = trimmed.split(/\s+/);
  for (const w of words) {
    const lettersOnly = w.replace(/[^a-zA-ZąčęėįšųūžĄČĘĖĮŠŲŪŽ]/g, '');
    if (lettersOnly.length >= 5 && !/[aeiouyąęėįųū]/i.test(lettersOnly)) {
      return true;
    }
  }

  // 5. 6+ simbolių/skyrybos ženklų be jokių raidžių ar skaitmenų (pvz. !@#$%^, ???????)
  const noLettersOrDigits = trimmed.replace(/[a-zA-Z0-9ąčęėįšųūžĄČĘĖĮŠŲŪŽ\s]/g, '');
  if (
    noLettersOrDigits.length >= 6 &&
    noLettersOrDigits.length === trimmed.replace(/\s+/g, '').length
  ) {
    return true;
  }

  return false;
}

function checkJailSpam(userId, messageContent) {
  const now = Date.now();
  const history = (jailUserMessageHistory.get(userId) || []).filter(
    item => now - item.timestamp < 15000
  );

  const content = (messageContent || '').trim();

  // 1. Random / gibberish tekstas
  if (isRandomGibberish(content)) {
    jailUserMessageHistory.delete(userId);
    return true;
  }

  // 2. Dubliuotas pranešimas greitai (tas pats tekstas 2 kartus per 5s arba 3 kartus per 15s)
  const exactDuplicatesRecent = history.filter(
    item => item.content.toLowerCase() === content.toLowerCase() && now - item.timestamp < 5000
  );
  if (exactDuplicatesRecent.length >= 1) {
    jailUserMessageHistory.delete(userId);
    return true;
  }
  const exactDuplicates15s = history.filter(
    item => item.content.toLowerCase() === content.toLowerCase()
  );
  if (exactDuplicates15s.length >= 2) {
    jailUserMessageHistory.delete(userId);
    return true;
  }

  // 3. Flood rate limits:
  // - 3 žinutės per 3.5 sekundės
  const in35s = history.filter(item => now - item.timestamp < 3500);
  if (in35s.length >= 2) {
    jailUserMessageHistory.delete(userId);
    return true;
  }

  // - 4 žinutės per 7 sekundes
  const in7s = history.filter(item => now - item.timestamp < 7000);
  if (in7s.length >= 3) {
    jailUserMessageHistory.delete(userId);
    return true;
  }

  // - 5 žinutės per 12 sekundžių
  if (history.length >= 4) {
    jailUserMessageHistory.delete(userId);
    return true;
  }

  history.push({ timestamp: now, content });
  jailUserMessageHistory.set(userId, history);
  return false;
}

async function penalizeJailMember(message, reasonText, auditReason) {
  try {
    const gifMsg = await message.reply({ content: SLAP_GIF_URL }).catch(() => null);

    const member =
      message.member ||
      (await message.guild.members.fetch(message.author.id).catch(() => null));

    if (member?.moderatable) {
      await member.timeout(SLAP_TIMEOUT_MS, auditReason).catch(() => {});
    }

    if (member) {
      await removeXp(member, SLAP_XP_PENALTY).catch(() => {});
    }

    const warnMsg = await message.channel
      .send(withAllowedMentions({ content: `${message.author}, ${reasonText}` }, { pingUsers: true }))
      .catch(() => null);

    setTimeout(() => message.delete().catch(() => {}), AUTO_DELETE_MS);
    if (gifMsg) setTimeout(() => gifMsg.delete().catch(() => {}), AUTO_DELETE_MS);
    if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => {}), AUTO_DELETE_MS);
  } catch (e) {
    console.error(`[jail penalty error - ${auditReason}]`, e);
  }
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

function buildJailEmbed(member, questionIndex, questions) {
  const total = questions.length;
  const currentQ = questions[questionIndex];
  return new EmbedBuilder()
    .setTitle('🚨 Tu pasodintas į kalėjimą!')
    .setDescription(
      `Sveikas atvykęs į kalėjimą, ${member}!\n\n` +
      `Tau apribota prieiga prie visų serverio kanalų. Norėdamas sugrįžti į serverį, privalai **teisingai atsakyti į visus ${total} klausimus**.\n\n` +
      `⚠️ **SVARBIOS TAISYKLĖS:**\n` +
      `• Jeigu bandysi @here, @everyone arba bet ką kitą **@ taginti** — gausi **slap**, **5 min. timeout** ir **-1 000 XP** (\`tu neturi teisės taginti -1k\`)!\n` +
      `• Jeigu **spaminsi random kažką** ar floodinsi — gausi **slap**, **5 min. timeout** ir **-1 000 XP** (\`apsiramink... -1k\`)!\n\n` +
      `Atsakymus rašyk šiame kanale. Neteisingi atsakymai ir pranešimai išsitrina po 5 sekundžių, o klausimas atsinaujina šiame pranešime.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `**${questionIndex + 1}/${total} Klausimas:**\n` +
      `👉 **${currentQ.question}**`
    )
    .setColor(0xed4245)
    .setTimestamp();
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
        PermissionFlagsBits.ManageMessages,
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
  const introEmbed = buildJailEmbed(targetMember, 0, pickedQuestions);

  const mainMsg = await jailChannel
    .send(
      withAllowedMentions(
        { content: `${targetMember}`, embeds: [introEmbed] },
        { pingUsers: true }
      )
    )
    .catch(() => null);

  db.prepare(`
    INSERT INTO jail_sessions (
      guild_id, user_id, channel_id, jailed_by, current_question_index, questions_data, hidden_channel_ids, question_message_id, created_at, status
    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'active')
  `).run(
    guild.id,
    targetMember.id,
    jailChannel.id,
    interaction.user.id,
    JSON.stringify(pickedQuestions),
    JSON.stringify(hiddenChannelIds),
    mainMsg ? mainMsg.id : null,
    Date.now()
  );

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
  jailUserMessageHistory.delete(session.user_id);

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
    jailUserMessageHistory.delete(session.user_id);
    await penalizeJailMember(message, 'tu neturi teisės taginti -1k.', 'Jail — bandymas taginti');
    return true;
  }

  // 2. Tikrinam ar spamina random kažką / floodina
  if (checkJailSpam(session.user_id, message.content)) {
    await penalizeJailMember(message, 'apsiramink... -1k', 'Jail — spamina random kažką');
    return true;
  }

  // 3. Tikrinam klausimo atsakymą
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
    const replyMsg = await message.reply('Bandyk dar kartą.').catch(() => null);
    setTimeout(() => message.delete().catch(() => {}), AUTO_DELETE_MS);
    if (replyMsg) {
      setTimeout(() => replyMsg.delete().catch(() => {}), AUTO_DELETE_MS);
    }
    return true;
  }

  const nextIndex = currentIndex + 1;

  if (nextIndex < questions.length) {
    db.prepare('UPDATE jail_sessions SET current_question_index = ? WHERE id = ?').run(
      nextIndex,
      session.id
    );

    const targetMember =
      message.member ||
      (await message.guild.members.fetch(session.user_id).catch(() => null));
    const updatedEmbed = buildJailEmbed(
      targetMember || message.author,
      nextIndex,
      questions
    );

    let mainMsg = null;
    if (session.question_message_id) {
      mainMsg = await message.channel.messages
        .fetch(session.question_message_id)
        .catch(() => null);
    }

    if (mainMsg) {
      await mainMsg.edit({ embeds: [updatedEmbed] }).catch(() => {});
    } else {
      const sent = await message.channel
        .send(
          withAllowedMentions(
            { content: `${message.author}`, embeds: [updatedEmbed] },
            { pingUsers: true }
          )
        )
        .catch(() => null);
      if (sent) {
        db.prepare('UPDATE jail_sessions SET question_message_id = ? WHERE id = ?').run(
          sent.id,
          session.id
        );
      }
    }

    const confirmMsg = await message
      .reply('✅ Teisingai! Klausimas atnaujintas viršuje.')
      .catch(() => null);

    setTimeout(() => message.delete().catch(() => {}), AUTO_DELETE_MS);
    if (confirmMsg) {
      setTimeout(() => confirmMsg.delete().catch(() => {}), AUTO_DELETE_MS);
    }
    return true;
  }

  // Visi klausimai atsakyti teisingai!
  setTimeout(() => message.delete().catch(() => {}), 1500);
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
  checkJailSpam,
  isRandomGibberish,
};
