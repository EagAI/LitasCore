const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createGiveaway, endGiveaway, rerollGiveaway } = require('../services/giveaway');
const { isStaff } = require('../utils/permissions');

function parseDuration(str) {
  const regex = /(\d+)\s*(d|h|m|s)/gi;
  let ms = 0;
  let match;
  while ((match = regex.exec(str)) !== null) {
    const val = parseInt(match[1]);
    switch (match[2].toLowerCase()) {
      case 'd': ms += val * 24 * 60 * 60 * 1000; break;
      case 'h': ms += val * 60 * 60 * 1000; break;
      case 'm': ms += val * 60 * 1000; break;
      case 's': ms += val * 1000; break;
    }
  }
  return ms;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Giveaway sistema')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(sub =>
      sub
        .setName('start')
        .setDescription('Pradėti giveaway')
        .addStringOption(opt =>
          opt.setName('prizas').setDescription('Prizas').setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('trukmė')
            .setDescription('Trukmė: pvz. 1d, 2h, 30m arba kombinacijos 1d 2h 30m')
            .setRequired(true)
        )
        .addIntegerOption(opt =>
          opt
            .setName('laimėtojai')
            .setDescription('Laimėtojų skaičius')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(10)
        )
        .addChannelOption(opt =>
          opt.setName('kanalas').setDescription('Kanalas (numatyta: dabartinis)')
        )
        .addStringOption(opt =>
          opt.setName('nuotrauka').setDescription('Nuotraukos URL (rodoma embede)')
        )
        .addStringOption(opt =>
          opt.setName('rolės').setDescription('Kas gali dalyvauti — @mention rolės (pvz: @VIP @Subscriber)')
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('end')
        .setDescription('Baigti giveaway anksčiau')
        .addStringOption(opt =>
          opt.setName('id').setDescription('Giveaway ID (iš pradžios žinutės)').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('reroll')
        .setDescription('Iš naujo ištraukti laimėtojus')
        .addStringOption(opt =>
          opt.setName('id').setDescription('Giveaway ID').setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: 'Tik staff gali valdyti giveaway.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
      const prize = interaction.options.getString('prizas');
      const durationStr = interaction.options.getString('trukmė');
      const winnersCount = interaction.options.getInteger('laimėtojai');
      const channel = interaction.options.getChannel('kanalas') || interaction.channel;
      const imageUrl = interaction.options.getString('nuotrauka') || null;
      const rolesStr = interaction.options.getString('rolės') || '';
      const requiredRoles = [...rolesStr.matchAll(/<@&(\d+)>/g)]
        .map(m => m[1])
        .filter(Boolean);

      const durationMs = parseDuration(durationStr);
      if (durationMs < 10_000) {
        return interaction.reply({
          content: '❌ Neteisinga trukmė. Naudok: `1d`, `2h`, `30m` arba kombinacijas kaip `1d 2h 30m`.',
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });
      const id = await createGiveaway(
        interaction.client,
        channel.id,
        interaction.guild.id,
        prize,
        winnersCount,
        durationMs,
        imageUrl,
        requiredRoles
      );
      return interaction.editReply({ content: `Giveaway (ID: \`${id}\`) pradėtas ${channel}!` });
    }

    if (sub === 'end') {
      const id = parseInt(interaction.options.getString('id'));
      if (isNaN(id)) return interaction.reply({ content: 'Neteisingas ID.', ephemeral: true });
      await endGiveaway(interaction.client, id);
      return interaction.reply({ content: 'Giveaway baigtas.', ephemeral: true });
    }

    if (sub === 'reroll') {
      const id = parseInt(interaction.options.getString('id'));
      if (isNaN(id)) return interaction.reply({ content: 'Neteisingas ID.', ephemeral: true });
      await rerollGiveaway(interaction.client, id);
      return interaction.reply({ content: 'Laimėtojai iš naujo ištraukti.', ephemeral: true });
    }
  },
};
