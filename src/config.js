function envTrim(key) {
  const v = process.env[key];
  return typeof v === 'string' ? v.trim() : '';
}

function parseCsvIds(key) {
  return envTrim(key)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function parseJsonEnv(key, fallback) {
  const raw = envTrim(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[config] ${key}: invalid JSON —`, e.message);
    return fallback;
  }
}

function buildLevelRoles() {
  const arr = parseJsonEnv('LEVEL_ROLES_JSON', []);
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(r => r && typeof r.level === 'number' && r.roleId)
    .map(r => ({ level: r.level, roleId: String(r.roleId) }));
}

function buildBadges() {
  const arr = parseJsonEnv('BADGES_JSON', []);
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(b => b && b.id && b.label && b.emoji)
    .map(b => ({
      id: String(b.id),
      label: String(b.label),
      emoji: String(b.emoji),
    }));
}

/** Keli kanalai: IDEAS_CHANNEL_IDS (kableliais); jei tuščia – senasis IDEAS_CHANNEL_ID. */
function buildIdeasChannelIds() {
  const multi = parseCsvIds('IDEAS_CHANNEL_IDS');
  if (multi.length) return multi;
  const single = envTrim('IDEAS_CHANNEL_ID');
  return single ? [single] : [];
}

/** Sveikinimo rolė(-s) naujiems nariams: WELCOME_ROLE_IDS arba vienas WELCOME_ROLE_ID. */
function buildWelcomeRoleIds() {
  const multi = parseCsvIds('WELCOME_ROLE_IDS');
  if (multi.length) return multi;
  const single = envTrim('WELCOME_ROLE_ID');
  return single ? [single] : [];
}

const levelRoles = buildLevelRoles();
const BADGES = buildBadges();
const BADGE_MAP = Object.fromEntries(BADGES.map(b => [b.id, b]));

module.exports = {
  token: envTrim('DISCORD_TOKEN'),
  clientId: envTrim('CLIENT_ID'),
  guildId: envTrim('GUILD_ID'),

  welcomeChannelId: envTrim('WELCOME_CHANNEL_ID'),
  logChannelId: envTrim('LOG_CHANNEL_ID'),
  ideasChannelIds: buildIdeasChannelIds(),
  boostChannelId: envTrim('BOOST_CHANNEL_ID'),
  levelUpChannelId: envTrim('LEVEL_UP_CHANNEL_ID'),
  youtubeAnnounceChannelId: envTrim('YOUTUBE_ANNOUNCE_CHANNEL_ID'),
  voiceCategoryId: envTrim('VOICE_CATEGORY_ID'),
  ticketsCategoryId: envTrim('TICKETS_CATEGORY_ID'),
  closedTicketsCategoryId: envTrim('CLOSED_TICKETS_CATEGORY_ID'),

  adminActionsChannelId:
    envTrim('ADMIN_ACTIONS_CHANNEL_ID'),

  pasekimuChannelId: envTrim('PASEKIMU_CHANNEL_ID'),

  staffRoleIds: parseCsvIds('STAFF_ROLE_IDS'),
  modRoleIds: parseCsvIds('MOD_ROLE_IDS'),
  welcomeRoleIds: buildWelcomeRoleIds(),

  levelRoles,
  BADGES,
  BADGE_MAP,

  tiktokUrl: envTrim('TIKTOK_URL'),

  youtubeChannelIds: envTrim('YOUTUBE_CHANNEL_IDS')
    ? envTrim('YOUTUBE_CHANNEL_IDS').split(',').map(s => s.trim()).filter(Boolean)
    : [],

  antiPingWindowMs: parseInt(process.env.ANTI_PING_WINDOW_MS || '600000', 10),
  antiPingWarnAt: parseInt(process.env.ANTI_PING_WARN_THRESHOLD || '3', 10),
  antiPingTimeoutAt: parseInt(process.env.ANTI_PING_TIMEOUT_THRESHOLD || '5', 10),
  antiPingTimeoutMs: parseInt(process.env.ANTI_PING_TIMEOUT_DURATION_MS || '1800000', 10),

  xpCooldownMs: parseInt(process.env.XP_COOLDOWN_MS || '5000', 10),
  xpPerMessage: parseInt(process.env.XP_PER_MESSAGE || '15', 10),
  voiceXpPerMinute: parseInt(process.env.VOICE_XP_PER_MINUTE || '8', 10),

  /** true = laikyti visas pasiektas lygio roles; false = tik aukščiausia (numatyta) */
  levelRolesStack: process.env.LEVEL_ROLES_STACK === 'true',
};
