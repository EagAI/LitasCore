const { EmbedBuilder } = require('discord.js');
const db = require('../db');

async function handleVoteButton(interaction) {
  const parts = interaction.customId.split('_');
  const voteId = parseInt(parts[1]);
  const optionIndex = parseInt(parts[2]);

  const vote = db.prepare('SELECT * FROM votes WHERE id = ?').get(voteId);
  if (!vote || vote.ended) {
    return interaction.reply({ content: 'Šis balsavimas baigtas arba nerastas.', ephemeral: true });
  }

  const options = JSON.parse(vote.options);
  if (optionIndex < 0 || optionIndex >= options.length) {
    return interaction.reply({ content: 'Neteisinga parinktis.', ephemeral: true });
  }

  const existing = db
    .prepare('SELECT option_index FROM vote_entries WHERE vote_id = ? AND user_id = ?')
    .get(voteId, interaction.user.id);

  if (existing?.option_index === optionIndex) {
    return interaction.reply({ content: 'Jau balsavote už šią parinktį.', ephemeral: true });
  }

  db.prepare(
    'INSERT OR REPLACE INTO vote_entries (vote_id, user_id, option_index) VALUES (?, ?, ?)'
  ).run(voteId, interaction.user.id, optionIndex);

  const counts = options.map((_, i) =>
    db
      .prepare('SELECT COUNT(*) as c FROM vote_entries WHERE vote_id = ? AND option_index = ?')
      .get(voteId, i).c
  );

  const total = counts.reduce((a, b) => a + b, 0);

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${vote.question}`)
    .setColor(0x5865f2)
    .addFields(
      options.map((opt, i) => ({
        name: `${i + 1}. ${opt}`,
        value: `${counts[i]} bals${counts[i] === 1 ? 'as' : 'ai'} (${
          total > 0 ? Math.round((counts[i] / total) * 100) : 0
        }%)`,
      }))
    )
    .setFooter({ text: `Viso: ${total} balsų` })
    .setTimestamp();

  await interaction.update({ embeds: [embed], components: interaction.message.components });
}

module.exports = { handleVoteButton };
