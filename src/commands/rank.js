const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { generateLygisImage } = require('../utils/lygisImage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lygis')
    .setDescription('Rodyti savo arba kito nario lygį')
    .addUserOption(opt =>
      opt.setName('narys').setDescription('Narys (tuščia = jūs patys)').setRequired(false)
    ),

  async execute(interaction) {
    const target = interaction.options.getMember('narys') ?? interaction.member;

    if (target.user.bot) {
      return interaction.reply({ content: 'Botai neturi lygių.', ephemeral: true });
    }

    await interaction.deferReply();

    try {
      const buffer = await generateLygisImage(target);
      const attachment = new AttachmentBuilder(buffer, { name: 'lygis.png' });
      await interaction.editReply({ files: [attachment] });
    } catch (err) {
      console.error('[lygis]', err);
      await interaction.editReply({ content: 'Nepavyko sugeneruoti lygio kortelės.' });
    }
  },
};
