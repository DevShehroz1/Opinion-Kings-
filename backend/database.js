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
      main_account_user_id TEXT,
      ip_address      TEXT,
      flagged_reason  TEXT
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

    CREATE TABLE IF NOT EXISTS credits_ledger (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES waitlist_users(id),
      email           TEXT NOT NULL,
      full_name       TEXT,
      referral_code   TEXT NOT NULL,
      referral_count  INTEGER NOT NULL DEFAULT 0,
      total_credits   INTEGER NOT NULL DEFAULT 0,
      vip_badge       INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'pending',
      last_updated    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now')),
      UNIQUE(user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_credits_ledger_user_id
      ON credits_ledger(user_id);

    CREATE TABLE IF NOT EXISTS share_clicks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES waitlist_users(id),
      channel    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_share_clicks_user_channel
      ON share_clicks(user_id, channel);

    CREATE TABLE IF NOT EXISTS international_waitlist (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL DEFAULT '',
      email           TEXT UNIQUE,
      country_code    TEXT,
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now')),
      ip_address      TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_international_email
      ON international_waitlist(email);
  `);

  try { db.exec(`ALTER TABLE waitlist_users ADD COLUMN full_name TEXT NOT NULL DEFAULT ''`); } catch (_) {}
  try { db.exec(`ALTER TABLE waitlist_users ADD COLUMN ip_address TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE waitlist_users ADD COLUMN flagged_reason TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE waitlist_users ADD COLUMN country_code TEXT`); } catch (_) {}
}

module.exports = { getDb };
