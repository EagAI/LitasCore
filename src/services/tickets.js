const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const db = require('../db');
const config = require('../config');
const { isStaff } = require('../utils/permissions');
const { withAllowedMentions } = require('../utils/allowedMentions');

async function handleTicketOpen(interaction) {
  const existing = db
    .prepare(
      'SELECT channel_id FROM tickets WHERE opener_user_id = ? AND guild_id = ? AND status = ?'
    )
    .get(interaction.user.id, interaction.guild.id, 'open');

  if (existing) {
    const ch = interaction.guild.channels.cache.get(existing.channel_id);
    return interaction.reply({
      content: ch ? `Jau turite atvirą tiketą: ${ch}` : 'Jau turite atvirą tiketą.',
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('ticket_modal')
    .setTitle('Sukurti tiketą');

  const descInput = new TextInputBuilder()
    .setCustomId('ticket_desc')
    .setLabel('Aprašymas')
    .setPlaceholder('Išsamiai aprašykite savo problemą ar klausimą...')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(descInput)
  );

  return interaction.showModal(modal);
}

async function handleTicketModal(interaction) {
  const desc = interaction.fields.getTextInputValue('ticket_desc');

  await interaction.deferReply({ ephemeral: true });

  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM tickets WHERE guild_id = ?').get(interaction.guild.id);
  const ticketNum = String((countRow?.cnt ?? 0) + 1).padStart(4, '0');
  const channelName = `ticket-${ticketNum}`;

  const overwrites = [
    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
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
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }

  const channel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: config.ticketsCategoryId || null,
    permissionOverwrites: overwrites,
  });

  db.prepare(
    'INSERT INTO tickets (guild_id, channel_id, opener_user_id, status, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(interaction.guild.id, channel.id, interaction.user.id, 'open', Date.now());

  const embed = new EmbedBuilder()
    .setTitle('🎫 Naujas tiketas')
    .setDescription(
      `**Narys:** ${interaction.user}\n\n**Aprašymas:**\n\`\`\`\n${desc}\n\`\`\``
    )
    .setColor(0x57f287)
    .setFooter({ text: interaction.user.tag })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Uždaryti tiketą')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒')
  );

  await channel.send(
    withAllowedMentions({
      content: `${interaction.user}`,
      embeds: [embed],
      components: [row],
    })
  );
  return interaction.editReply({ content: `Tiketas sukurtas: ${channel}` });
}

async function sendTicketClosedDmToOpener(client, { ticket, guild, closedBy, reason }) {
  try {
    const user = await client.users.fetch(ticket.opener_user_id);
    const reasonText = reason?.trim() ? reason.trim() : 'be priežasties';
    const embed = new EmbedBuilder()
      .setTitle('Tiketas uždarytas')
      .setColor(0xed4245)
      .addFields(
        { name: 'Uždarė', value: closedBy.tag, inline: true },
        { name: 'Serveris', value: guild.name, inline: true },
        { name: 'Priežastis', value: reasonText, inline: false }
      )
      .setFooter({
        text: 'Tiketai nesaugomi. Jeigu buvo klaida — iškelkite per naują.',
      })
      .setTimestamp();
    await user.send({ embeds: [embed] });
  } catch (err) {
    console.warn('[ticket] Neišsiųsta DM atidarytojui (DM išjungta arba vartotojas neprieinamas):', err?.message);
  }
}

async function handleTicketClose(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Tik staff gali uždaryti tiketus.', ephemeral: true });
  }

  const ticket = db
    .prepare('SELECT * FROM tickets WHERE channel_id = ? AND status = ?')
    .get(interaction.channel.id, 'open');

  if (!ticket) {
    return interaction.reply({ content: 'Šis kanalas nėra aktyvus tiketas.', ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId('ticket_close_modal')
    .setTitle('Uždaryti tiketą');

  const reasonInput = new TextInputBuilder()
    .setCustomId('ticket_close_reason')
    .setLabel('Priežastis')
    .setPlaceholder('Kodėl uždarote tiketą? (nebūtina)')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(500)
    .setRequired(false);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return interaction.showModal(modal);
}

async function handleTicketCloseModal(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Tik staff gali uždaryti tiketus.', ephemeral: true });
  }

  const ticket = db
    .prepare('SELECT * FROM tickets WHERE channel_id = ? AND status = ?')
    .get(interaction.channel.id, 'open');

  if (!ticket) {
    return interaction.reply({ content: 'Šis kanalas nėra aktyvus tiketas.', ephemeral: true });
  }

  const reason = interaction.fields.getTextInputValue('ticket_close_reason');
  const channel = interaction.channel;

  db.prepare('UPDATE tickets SET status = ? WHERE channel_id = ?').run(
    'closed',
    channel.id
  );

  await interaction.reply({
    content: 'Tiketas uždarytas. Kanalas ištrintas.',
    ephemeral: true,
  });

  await sendTicketClosedDmToOpener(interaction.client, {
    ticket,
    guild: interaction.guild,
    closedBy: interaction.user,
    reason,
  });

  try {
    await channel.delete('Tiketas uždarytas');
  } catch (err) {
    console.error('[ticket] Nepavyko ištrinti kanalo:', err?.message || err);
  }
}

module.exports = {
  handleTicketOpen,
  handleTicketModal,
  handleTicketClose,
  handleTicketCloseModal,
};
