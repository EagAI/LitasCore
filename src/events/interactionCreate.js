const { PermissionFlagsBits } = require('discord.js');
const { handleTicketOpen, handleTicketModal, handleTicketClose } = require('../services/tickets');
const { handleGiveawayEnter } = require('../services/giveaway');
const { handleVoteButton } = require('../services/vote');
const { handleIdeaVote } = require('../services/ideas');
const db = require('../db');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (_) {
        const payload = { content: 'Klaida vykdant komandą.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'ticket_modal') return handleTicketModal(interaction);
    }

    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id.startsWith('scam:ban:') || id.startsWith('scam:untimeout:')) {
        const { handleScamLogButton } = require('../services/scamLogButtons');
        return handleScamLogButton(interaction);
      }
      if (interaction.customId === 'ticket_open') return handleTicketOpen(interaction);
      if (interaction.customId === 'ticket_close') return handleTicketClose(interaction);
      if (interaction.customId.startsWith('giveaway_enter_')) return handleGiveawayEnter(interaction);
      if (interaction.customId.startsWith('vote_')) return handleVoteButton(interaction);
      if (interaction.customId.startsWith('idea_')) return handleIdeaVote(interaction);

      if (interaction.customId === 'vc_lock' || interaction.customId === 'vc_unlock') {
        const channel = interaction.channel;
        const record = db
          .prepare('SELECT * FROM voice_channels WHERE channel_id = ?')
          .get(channel.id);

        if (!record) {
          return interaction.reply({ content: 'Šis kanalas nėra valdomas.', ephemeral: true });
        }
        if (record.owner_id !== interaction.user.id) {
          return interaction.reply({ content: '❌ Tik kanalo savininkas gali jį valdyti.', ephemeral: true });
        }

        const locking = interaction.customId === 'vc_lock';

        await channel.permissionOverwrites.edit(channel.guild.id, {
          [PermissionFlagsBits.Connect]: locking ? false : null,
        }).catch(() => {});

        const { buildVoicePanel } = require('../services/voicePanel');
        await interaction.update(buildVoicePanel(locking));
        return;
      }
    }
  },
};
