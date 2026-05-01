/**
 * Paskutinės žinomos rolių būsenos snapshot — kad guildMemberUpdate loguose
 * nebūtų „ghost“ pridėjimų, kai discord.js oldMember.roles cache dar nepilnas.
 */
const snapshots = new Map();

function key(member) {
  return `${member.guild.id}:${member.id}`;
}

function serialize(member) {
  return [...member.roles.cache.keys()].sort().join(',');
}

/** Užfiksuoti dabartinę būseną be tolimesnio diff (pvz. po join / atkūrimo). */
function seedRoleSnapshot(member) {
  if (!member?.guild?.id || !member.id) return;
  snapshots.set(key(member), serialize(member));
}

function clearRoleSnapshot(guildId, userId) {
  snapshots.delete(`${guildId}:${userId}`);
}

/**
 * Palygina dabartinę narį su paskutiniu snapshot; atnaujina snapshot.
 * Pirmas stebėjimas: tik inicializuoja snapshot, grąžina tuščius added/removed.
 */
function diffRolesSinceSnapshot(member) {
  if (!member?.guild) {
    return { added: [], removed: [] };
  }

  const k = key(member);
  const now = serialize(member);
  const prev = snapshots.get(k);
  snapshots.set(k, now);

  if (prev === undefined) {
    return { added: [], removed: [] };
  }

  const prevSet = new Set(prev.split(',').filter(Boolean));
  const nowSet = new Set(now.split(',').filter(Boolean));
  const guild = member.guild;

  const addedIds = [...nowSet].filter(id => !prevSet.has(id));
  const removedIds = [...prevSet].filter(id => !nowSet.has(id));

  const toDisplay = id => guild.roles.cache.get(id) ?? { id, toString: () => `<@&${id}>` };

  return {
    added: addedIds.map(toDisplay),
    removed: removedIds.map(toDisplay),
  };
}

module.exports = {
  seedRoleSnapshot,
  clearRoleSnapshot,
  diffRolesSinceSnapshot,
};
