const { syncInviteCache } = require('../services/inviteTracking');

module.exports = {
  name: 'inviteCreate',
  async execute(invite) {
    if (!invite.guild) return;
    await syncInviteCache(invite.guild);
  },
};
