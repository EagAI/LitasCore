function envTrim(key) {
  const v = process.env[key];
  return typeof v === 'string' ? v.trim() : '';
}

/** Priklausomas nuo serverio emoji pavadinimo; jei nėra ID – Unicode. */
function strCustomEmoji(emojiName, envIdKey, unicodeFallback) {
  const id = envTrim(envIdKey);
  return id ? `<:${emojiName}:${id}>` : unicodeFallback;
}

function parseCsvIds(key) {
  return envTrim(key)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Lygio milestone rolės iš `LEVEL_<lygis>_ROLE_ID` (pvz. LEVEL_5_ROLE_ID).
 */
function buildLevelRoles() {
  const fromEnv = [];
  const re = /^LEVEL_(\d+)_ROLE_ID$/i;
  for (const key of Object.keys(process.env)) {
    const m = key.match(re);
    if (!m) continue;
    const level = parseInt(m[1], 10);
    if (!Number.isFinite(level) || level < 1) continue;
    const roleId = envTrim(key);
    if (roleId) fromEnv.push({ level, roleId });
  }
  fromEnv.sort((a, b) => a.level - b.level);
  return fromEnv;
}

/** Ženkliuko Discord emoji vardas serveryje (dalis <:name:id>). */
const BADGE_ENV_SPECS = [
  { id: 'streamer', label: 'Streamer', emojiName: 'streamer', envKey: 'STREAMER_BADGE_ID' },
  { id: 'vip', label: 'VIP', emojiName: 'vip', envKey: 'VIP_BADGE_ID' },
  { id: 'supporteris', label: 'Supporteris', emojiName: 'supporteris', envKey: 'SUPPORTERIS_BADGE_ID' },
  { id: 'padeka', label: 'Padėka', emojiName: 'padeka', envKey: 'PADEKA_BADGE_ID' },
  { id: 'administracija', label: 'Administracija', emojiName: 'administracija', envKey: 'ADMINISTRACIJA_BADGE_ID' },
];

/** Ženkleliai iš `*_BADGE_ID` (Discord emoji snowflake). */
function buildBadges() {
  const out = [];
  for (const spec of BADGE_ENV_SPECS) {
    const snowflake = envTrim(spec.envKey);
    if (!snowflake) continue;
    out.push({
      id: spec.id,
      label: spec.label,
      emoji: `<:${spec.emojiName}:${snowflake}>`,
    });
  }
  return out;
}

/** Idėjų kanalas (vienas snowflake); tuščia = funkcija išjungta. */
function buildIdeasChannelIds() {
  const id = envTrim('IDEAS_CHANNEL_ID');
  return id ? [id] : [];
}

/** Naujoko rolė (vienas snowflake); tuščia — nerodoma. */
function buildWelcomeRoleIds() {
  const id = envTrim('WELCOME_ROLE_ID');
  return id ? [id] : [];
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

  adminActionsChannelId:
    envTrim('ADMIN_ACTIONS_CHANNEL_ID'),

  pasekimuChannelId: envTrim('PASEKIMU_CHANNEL_ID'),

  /**
   * „Blacklist“ rolė: DB sąrašas, giveaway blokas.
   */
  blacklistRoleId: envTrim('BLACKLIST_ROLE_ID'),

  staffRoleIds: parseCsvIds('STAFF_ROLE_IDS'),
  modRoleIds: parseCsvIds('MOD_ROLE_IDS'),
  welcomeRoleIds: buildWelcomeRoleIds(),

  levelRoles,
  BADGES,
  BADGE_MAP,

  tiktokUrl: envTrim('TIKTOK_URL'),

  /** Vienas YouTube kanalo UC… ID RSS skelbimams. */
  youtubeChannelId: envTrim('YOUTUBE_CHANNEL_ID'),

  antiPingWindowMs: parseInt(process.env.ANTI_PING_WINDOW_MS || '600000', 10),
  antiPingWarnAt: parseInt(process.env.ANTI_PING_WARN_THRESHOLD || '3', 10),
  antiPingTimeoutAt: parseInt(process.env.ANTI_PING_TIMEOUT_THRESHOLD || '5', 10),
  antiPingTimeoutMs: parseInt(process.env.ANTI_PING_TIMEOUT_DURATION_MS || '1800000', 10),

  xpCooldownMs: parseInt(process.env.XP_COOLDOWN_MS || '5000', 10),
  xpPerMessage: parseInt(process.env.XP_PER_MESSAGE || '15', 10),
  voiceXpPerMinute: parseInt(process.env.VOICE_XP_PER_MINUTE || '8', 10),

  /** true = laikyti visas pasiektas lygio roles; false = tik aukščiausia (numatyta) */
  levelRolesStack: process.env.LEVEL_ROLES_STACK === 'true',

  emojis: {
    levelup: strCustomEmoji('levelup', 'EMOJI_LEVELUP', '⬆️'),
    giveawayGift: strCustomEmoji('dovanos', 'EMOJI_GIVEAWAY_GIFT', '🎁'),
    giveawayParticipants: strCustomEmoji('dalyviai', 'EMOJI_GIVEAWAY_PARTICIPANTS', '👥'),
    giveawayClock: strCustomEmoji('clock', 'EMOJI_GIVEAWAY_CLOCK', '⏰'),
    giveawayWinner: strCustomEmoji('winner', 'EMOJI_GIVEAWAY_WINNER', '🏆'),
    giveawayLock: strCustomEmoji('lock', 'EMOJI_GIVEAWAY_LOCK', '🔒'),
  },

  /** Dalyvauti mygtukas: jei nustatytas EMOJI_GIVEAWAY_ENTER – atskiras ID, kitu atveju PARTICIPANTS. */
  giveawayButtonEmoji: (() => {
    const id = envTrim('EMOJI_GIVEAWAY_ENTER') || envTrim('EMOJI_GIVEAWAY_PARTICIPANTS');
    return id ? { id, name: 'dalyviai', animated: false } : '🎉';
  })(),
};
