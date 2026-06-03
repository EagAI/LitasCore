/** English + Lithuanian letters, numbers, spaces, common symbols (canvas-safe). */
const SUPPORTED_NAME = /^[a-zA-ZĄČĘĖĮŠŲŪŽąčęėįšųūž0-9 _.\-()]+$/;

function isSupportedLeaderboardName(name) {
  return typeof name === 'string' && name.length > 0 && SUPPORTED_NAME.test(name);
}

/**
 * Server nickname first; username if nickname has unsupported chars/emojis.
 * @param {import('discord.js').GuildMember} member
 */
function getLeaderboardName(member) {
  const nickname = member.displayName;
  const username = member.user.username;

  if (!isSupportedLeaderboardName(nickname)) {
    return username;
  }

  return nickname;
}

/** Kai nėra GuildMember — pvz. tik User fetch. */
function pickLeaderboardDisplayName(nickname, username) {
  const nick = nickname || username;
  const user = username || nick;
  if (!isSupportedLeaderboardName(nick)) {
    return user;
  }
  return nick;
}

function truncateLeaderboardName(name, maxLen) {
  if (!name || name.length <= maxLen) return name;
  return `${name.slice(0, maxLen - 2)}…`;
}

module.exports = {
  getLeaderboardName,
  pickLeaderboardDisplayName,
  truncateLeaderboardName,
  isSupportedLeaderboardName,
};
