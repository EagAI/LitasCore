const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');

function isStaff(member) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return config.staffRoleIds.some(id => member.roles.cache.has(id));
}

module.exports = { isStaff };
