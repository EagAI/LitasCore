const db = require('../db');

function getBalance(userId, guildId) {
  const row = db
    .prepare('SELECT balance FROM economy WHERE user_id=? AND guild_id=?')
    .get(userId, guildId);
  return row?.balance ?? 0;
}

function addBalance(userId, guildId, amount) {
  db.prepare(`
    INSERT INTO economy (user_id, guild_id, balance)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, guild_id) DO UPDATE SET balance = balance + excluded.balance
  `).run(userId, guildId, amount);
  return getBalance(userId, guildId);
}

function removeBalance(userId, guildId, amount) {
  const current = getBalance(userId, guildId);
  const newBal = Math.max(0, current - amount);
  db.prepare(`
    INSERT INTO economy (user_id, guild_id, balance)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, guild_id) DO UPDATE SET balance = excluded.balance
  `).run(userId, guildId, newBal);
  return newBal;
}

module.exports = { getBalance, addBalance, removeBalance };
