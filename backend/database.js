const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'waitlist.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS waitlist_users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL DEFAULT '',
      email           TEXT UNIQUE,
      phone           TEXT UNIQUE,
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now')),
      referral_code   TEXT UNIQUE NOT NULL,
      referrer_id     INTEGER REFERENCES waitlist_users(id),
      boost_points    INTEGER NOT NULL DEFAULT 0,
      referral_count  INTEGER NOT NULL DEFAULT 0,
      credits_earned  INTEGER NOT NULL DEFAULT 0,
      vip_badge       INTEGER NOT NULL DEFAULT 0,
      main_account_user_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_users_ranking
      ON waitlist_users(boost_points DESC, created_at ASC);

    CREATE INDEX IF NOT EXISTS idx_users_referral_code
      ON waitlist_users(referral_code);

    CREATE TABLE IF NOT EXISTS referrals (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id      INTEGER NOT NULL REFERENCES waitlist_users(id),
      referred_user_id INTEGER NOT NULL REFERENCES waitlist_users(id),
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now')),
      status           TEXT NOT NULL DEFAULT 'confirmed',
      UNIQUE(referrer_id, referred_user_id)
    );

    CREATE TABLE IF NOT EXISTS reward_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES waitlist_users(id),
      type       TEXT NOT NULL,
      amount     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_reward_events_user_type
      ON reward_events(user_id, type);
  `);

  try {
    db.exec(`ALTER TABLE waitlist_users ADD COLUMN full_name TEXT NOT NULL DEFAULT ''`);
  } catch (_) { /* column already exists */ }
}

module.exports = { getDb };
