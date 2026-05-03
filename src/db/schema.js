function addColumnIfMissing(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function runMigrations(db) {
  addColumnIfMissing(db, 'levels', 'total_messages', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'levels', 'total_voice_minutes', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'levels', 'voice_joined_at', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'giveaways', 'image_url', 'TEXT');
  addColumnIfMissing(db, 'giveaways', 'required_roles', 'TEXT NOT NULL DEFAULT ""');
  addColumnIfMissing(db, 'guild_leavers', 'reason', 'TEXT');
}

function setupSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS levels (
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 0,
      last_xp_time INTEGER NOT NULL DEFAULT 0,
      total_messages INTEGER NOT NULL DEFAULT 0,
      total_voice_minutes INTEGER NOT NULL DEFAULT 0,
      voice_joined_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, guild_id)
    );

    CREATE TABLE IF NOT EXISTS level_roles (
      guild_id TEXT NOT NULL,
      level INTEGER NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, level)
    );

    CREATE TABLE IF NOT EXISTS giveaways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      prize TEXT NOT NULL,
      winners INTEGER NOT NULL DEFAULT 1,
      end_time INTEGER NOT NULL,
      ended INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS giveaway_entries (
      giveaway_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (giveaway_id, user_id),
      FOREIGN KEY (giveaway_id) REFERENCES giveaways(id)
    );

    CREATE TABLE IF NOT EXISTS youtube_state (
      yt_channel_id TEXT PRIMARY KEY,
      last_video_id TEXT
    );

    CREATE TABLE IF NOT EXISTS youtube_announced_titles (
      yt_channel_id TEXT NOT NULL,
      title_norm    TEXT NOT NULL,
      PRIMARY KEY (yt_channel_id, title_norm)
    );

    CREATE TABLE IF NOT EXISTS voice_channels (
      channel_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      owner_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS anti_ping (
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      window_start INTEGER NOT NULL DEFAULT 0,
      count INTEGER NOT NULL DEFAULT 0,
      warned INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, guild_id)
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT UNIQUE NOT NULL,
      opener_user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      question TEXT NOT NULL,
      options TEXT NOT NULL,
      ended INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS vote_entries (
      vote_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      option_index INTEGER NOT NULL,
      PRIMARY KEY (vote_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS bot_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS economy (
      user_id  TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      balance  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, guild_id)
    );

    CREATE TABLE IF NOT EXISTS user_badges (
      user_id   TEXT NOT NULL,
      guild_id  TEXT NOT NULL,
      badge_id  TEXT NOT NULL,
      added_at  INTEGER NOT NULL DEFAULT 0,
      added_by  TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (user_id, guild_id, badge_id)
    );

    CREATE TABLE IF NOT EXISTS ideas (
      message_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      author_id  TEXT NOT NULL,
      content    TEXT NOT NULL,
      image_url  TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idea_votes (
      message_id TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      vote_type  TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS member_roles_backup (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      role_ids TEXT NOT NULL DEFAULT '[]',
      left_at  INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS guild_member_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('join', 'leave')),
      at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_guild_member_events_lookup
      ON guild_member_events (guild_id, user_id);

    CREATE TABLE IF NOT EXISTS guild_leavers (
      guild_id   TEXT    NOT NULL,
      user_id    TEXT    NOT NULL,
      marked_at  INTEGER NOT NULL,
      reason     TEXT,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  runMigrations(db);
}

module.exports = { setupSchema };
