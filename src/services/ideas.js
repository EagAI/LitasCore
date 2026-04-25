const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const db = require('../db');
const config = require('../config');

function buildEmbed(message, imageUrl, upCount, downCount) {
  const embed = new EmbedBuilder()
    .setAuthor({
      name: message.author.displayName || message.author.username,
      iconURL: message.author.displayAvatarURL({ size: 64 }),
    })
    .setDescription(message.content || '*(tuščia žinutė)*')
    .setColor(0x5865f2);

  if (imageUrl) embed.setImage(imageUrl);
  return embed;
}

function buildRow(messageId, userVote, upCount, downCount) {
  const upStyle = userVote === 'up' ? ButtonStyle.Success : ButtonStyle.Secondary;
  const downStyle = userVote === 'down' ? ButtonStyle.Danger : ButtonStyle.Secondary;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`idea_up_${messageId}`)
      .setLabel(`👍 ${upCount}`)
      .setStyle(upStyle),
    new ButtonBuilder()
      .setCustomId(`idea_down_${messageId}`)
      .setLabel(`👎 ${downCount}`)
      .setStyle(downStyle)
  );
}

function getCounts(messageId) {
  const up = db
    .prepare("SELECT COUNT(*) as c FROM idea_votes WHERE message_id = ? AND vote_type = 'up'")
    .get(messageId).c;
  const down = db
    .prepare("SELECT COUNT(*) as c FROM idea_votes WHERE message_id = ? AND vote_type = 'down'")
    .get(messageId).c;
  return { up, down };
}

async function handleIdeasChannel(message) {
  if (message.author.bot) return;

  const imageAttachment = message.attachments.find(a =>
    a.contentType?.startsWith('image/')
  );
  const imageUrl = imageAttachment?.url || null;

  await message.delete().catch(() => {});

  const tempEmbed = buildEmbed(message, imageUrl, 0, 0);
  const tempRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('idea_up_temp')
      .setLabel('👍 0')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('idea_down_temp')
      .setLabel('👎 0')
      .setStyle(ButtonStyle.Secondary)
  );

  const sent = await message.channel.send({ embeds: [tempEmbed], components: [tempRow] });

  db.prepare(
    'INSERT INTO ideas (message_id, channel_id, author_id, content, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(sent.id, message.channel.id, message.author.id, message.content || '', imageUrl, Date.now());

  const finalRow = buildRow(sent.id, null, 0, 0);
  await sent.edit({ components: [finalRow] });
}

async function handleIdeaVote(interaction) {
  const parts = interaction.customId.split('_');
  const voteType = parts[1];
  const messageId = parts[2];

  if (!messageId || messageId === 'temp') {
    return interaction.reply({ content: 'Šis mygtukas dar neaktyvus.', ephemeral: true });
  }

  const idea = db.prepare('SELECT * FROM ideas WHERE message_id = ?').get(messageId);
  if (!idea) {
    return interaction.reply({ content: 'Idėja nerasta.', ephemeral: true });
  }

  const existing = db
    .prepare('SELECT vote_type FROM idea_votes WHERE message_id = ? AND user_id = ?')
    .get(messageId, interaction.user.id);

  if (existing) {
    if (existing.vote_type === voteType) {
      db.prepare('DELETE FROM idea_votes WHERE message_id = ? AND user_id = ?').run(
        messageId,
        interaction.user.id
      );
    } else {
      db.prepare(
        'UPDATE idea_votes SET vote_type = ? WHERE message_id = ? AND user_id = ?'
      ).run(voteType, messageId, interaction.user.id);
    }
  } else {
    db.prepare(
      'INSERT INTO idea_votes (message_id, user_id, vote_type) VALUES (?, ?, ?)'
    ).run(messageId, interaction.user.id, voteType);
  }

  const userVoteAfter = db
    .prepare('SELECT vote_type FROM idea_votes WHERE message_id = ? AND user_id = ?')
    .get(messageId, interaction.user.id);

  const { up, down } = getCounts(messageId);

  const fakeMessage = {
    author: {
      displayName: interaction.message.embeds[0]?.author?.name || 'Narys',
      username: interaction.message.embeds[0]?.author?.name || 'Narys',
      displayAvatarURL: () => interaction.message.embeds[0]?.author?.iconURL || '',
    },
    content: interaction.message.embeds[0]?.description || '',
  };

  const embed = new EmbedBuilder()
    .setAuthor({
      name: interaction.message.embeds[0]?.author?.name || 'Narys',
      iconURL: interaction.message.embeds[0]?.author?.iconURL,
    })
    .setDescription(interaction.message.embeds[0]?.description || '')
    .setColor(0x5865f2);

  if (idea.image_url) embed.setImage(idea.image_url);

  const row = buildRow(messageId, userVoteAfter?.vote_type || null, up, down);

  await interaction.update({ embeds: [embed], components: [row] });
}

module.exports = { handleIdeasChannel, handleIdeaVote };
