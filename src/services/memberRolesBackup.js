const { PermissionFlagsBits } = require('discord.js');
const db = require('../db');

/** Kol vyksta backup atkūrimas — log'e rodomas kitas pavadinimas. */
const restoringRoleAdds = new Set();

function markRoleBackupRestoreStarted(guildId, userId) {
  restoringRoleAdds.add(`${guildId}:${userId}`);
}

function markRoleBackupRestoreFinished(guildId, userId) {
  const key = `${guildId}:${userId}`;
  setTimeout(() => restoringRoleAdds.delete(key), 20_000);
}

function isRoleBackupRestoreAddingRoles(guildId, userId) {
  return restoringRoleAdds.has(`${guildId}:${userId}`);
}

function saveMemberRolesBackup(member) {
  if (!member.guild?.id || !member.id) return;
  try {
    const guild = member.guild;
    const roles = [...member.roles.cache.values()]
      .filter(r => r.id !== guild.id)
      .sort((a, b) => a.position - b.position)
      .map(r => r.id);
    const json = JSON.stringify(roles);

    db.prepare(
      `
      INSERT INTO member_roles_backup (guild_id, user_id, role_ids, left_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        role_ids = excluded.role_ids,
        left_at = excluded.left_at
    `
    ).run(guild.id, member.id, json, Date.now());
  } catch (e) {
    console.error('[roles-backup] save:', e?.message || e);
  }
}

function isRoleAssignableByBot(guild, role) {
  const me = guild.members.me;
  if (!me?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) return false;
  if (!role?.id || role.id === guild.id) return false;
  try {
    return me.roles.highest.comparePositionTo(role) > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Prideda prieš tai turėtas roles, kai narys išėjo ir grįžo.
 */
async function restoreMemberRolesBackup(member) {
  if (!member.guild?.id || !member.id) return;

  const row = db
    .prepare(
      `SELECT rowid, role_ids FROM member_roles_backup WHERE guild_id = ? AND user_id = ?`
    )
    .get(member.guild.id, member.id);

  if (!row?.role_ids) return;

  let ids;
  try {
    ids = JSON.parse(row.role_ids);
  } catch (_) {
    return;
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    db.prepare(`DELETE FROM member_roles_backup WHERE rowid = ?`).run(row.rowid);
    return;
  }

  const guild = member.guild;
  const botMe = guild.members.me;
  if (!botMe?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) {
    console.warn('[roles-backup] nėra Manage Roles – praleidžiama atkūrimo.');
    return;
  }

  const toAdd = [];
  for (const id of ids) {
    const role = guild.roles.cache.get(id);
    if (!role) continue;
    if (!isRoleAssignableByBot(guild, role)) continue;
    if (member.roles.cache.has(id)) continue;
    toAdd.push(role.id);
  }

  const del = () =>
    db.prepare(`DELETE FROM member_roles_backup WHERE rowid = ?`).run(row.rowid);

  if (toAdd.length === 0) {
    del();
    return;
  }

  markRoleBackupRestoreStarted(member.guild.id, member.id);
  try {
    const chunkSize = 8;
    for (let i = 0; i < toAdd.length; i += chunkSize) {
      const chunk = toAdd.slice(i, i + chunkSize);
      try {
        await member.roles.add(chunk);
      } catch (e) {
        for (const rid of chunk) {
          try {
            await member.roles.add(rid);
          } catch (_) {
            /* */
          }
        }
      }
      if (i + chunkSize < toAdd.length) {
        await new Promise(r => setTimeout(r, 250));
      }
    }

    del();
  } finally {
    markRoleBackupRestoreFinished(member.guild.id, member.id);
  }
}

module.exports = {
  saveMemberRolesBackup,
  restoreMemberRolesBackup,
  isRoleBackupRestoreAddingRoles,
};
