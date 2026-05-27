const { syncInviteCache } = require('../services/inviteTracking');

module.exports = {
  name: 'inviteDelete',
  async execute(invite) {
    if (!invite.guild) return;
    await syncInviteCache(invite.guild);
  },
};
