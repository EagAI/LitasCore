const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function buildVoicePanel(locked) {
  const embed = new EmbedBuilder()
    .setTitle('🎙️ Voice kanalo kontrolė')
    .setDescription(
      locked
        ? '🔒 Kanalas **užrakintas** — nauji nariai negali prisijungti.'
        : '🔓 Kanalas **atviras** — visi gali prisijungti.'
    )
    .setColor(locked ? 0xe03030 : 0x57f287);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(locked ? 'vc_unlock' : 'vc_lock')
      .setLabel(locked ? 'Atrakinti' : 'Užrakinti')
      .setEmoji(locked ? '🔓' : '🔒')
      .setStyle(locked ? ButtonStyle.Success : ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

module.exports = { buildVoicePanel };
