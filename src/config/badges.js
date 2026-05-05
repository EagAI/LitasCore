/**
 * Kai kur diegimuose admin komanda dar krauna `../config/badges`.
 * Ženklelių aprašymai gyvena `src/config.js` — čia tik peradresavimas.
 */
const { BADGES, BADGE_MAP, blacklistRoleId } = require('../config');

module.exports = {
  BADGES,
  BADGE_MAP,
  blacklistRoleId,
};
