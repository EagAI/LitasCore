/**
 * Embede: `<@id>` tik nariams serveryje (paspaudžiami mention'ai).
 * Ilguose sąrašuose (>~10) Discord neberenderina — todėl userstats puslapiuoja po 5.
 * Palikus serverį — paprastas `@vardas (paliko)` tekstas.
 */
function userDisplayName(user) {
  return user.globalName || user.username || user.id;
}

async function mapInBatches(items, batchSize, fn) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(fn));
  }
}

async function resolveUserLabelMap(guild, userIds, client) {
  const unique = [...new Set(userIds.filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;

  const discord = client ?? guild.client;
  const missing = [];

  for (const id of unique) {
    const cached = guild.members.cache.get(id);
    if (cached) map.set(id, `<@${id}>`);
    else missing.push(id);
  }

  await mapInBatches(missing, 8, async id => {
    const member = await guild.members.fetch(id).catch(() => null);
    if (member) map.set(id, `<@${id}>`);
  });

  const stillMissing = unique.filter(id => !map.has(id));
  await mapInBatches(stillMissing, 8, async id => {
    const user = await discord.users.fetch(id).catch(() => null);
    if (user) map.set(id, `@${userDisplayName(user)} (paliko)`);
    else map.set(id, `\`${id}\` (nežinomas)`);
  });

  return map;
}

function userLabel(labelMap, userId) {
  if (!userId) return '—';
  return labelMap.get(userId) ?? `\`${userId}\``;
}

module.exports = { resolveUserLabelMap, userLabel };
