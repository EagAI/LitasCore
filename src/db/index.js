const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { setupSchema } = require('./schema');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'euras.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
setupSchema(db);

module.exports = db;
