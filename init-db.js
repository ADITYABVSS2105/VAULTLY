/**
 * Vaultly — Database Initializer
 * Supports both Neon (DATABASE_URL) and local PostgreSQL
 * Run with: node init-db.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

async function run() {
  // Connect using DATABASE_URL (Neon) or individual vars (local)
  const pool = process.env.DATABASE_URL
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      })
    : new Pool({
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME     || 'vaultly',
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
      });

  console.log('\n🔌 Connecting to database…');
  await pool.query('SELECT 1'); // ping
  console.log('✅ Connected!\n');

  console.log('📦 Running schema migrations…');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR(120)  NOT NULL DEFAULT '',
      email         VARCHAR(255)  NOT NULL UNIQUE,
      password_hash VARCHAR(255)  NOT NULL,
      created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );
  `);
  console.log('  ✅ users table ready');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      VARCHAR(255)   NOT NULL,
      amount     NUMERIC(12,2)  NOT NULL CHECK (amount > 0),
      type       VARCHAR(10)    NOT NULL CHECK (type IN ('credit','debit')),
      category   VARCHAR(100)   NOT NULL DEFAULT 'Other',
      method     VARCHAR(100)   NOT NULL DEFAULT 'Cash',
      date       DATE           NOT NULL,
      note       TEXT           NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ    NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date DESC);
  `);
  console.log('  ✅ transactions table ready');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS budgets (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category     VARCHAR(100)   NOT NULL,
      limit_amount NUMERIC(12,2)  NOT NULL DEFAULT 5000,
      UNIQUE (user_id, category)
    );
  `);
  console.log('  ✅ budgets table ready');

  // ---- Seed Demo User ----
  const demoEmail = 'demo@vaultly.app';
  const existing  = await pool.query('SELECT id FROM users WHERE email = $1', [demoEmail]);

  if (existing.rows.length === 0) {
    console.log('\n🌱 Seeding demo user…');

    const hash    = await bcrypt.hash('demo1234', 10);
    const userRes = await pool.query(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      ['Aryan Mehta', demoEmail, hash]
    );
    const userId = userRes.rows[0].id;

    // Default budgets
    const budgets = [
      ['Food & Dining',          8000],
      ['Shopping & Clothes',     5000],
      ['Bills & Utilities',      6000],
      ['Travel & Transport',     4000],
      ['Entertainment & Movies', 3000],
    ];
    for (const [cat, lim] of budgets) {
      await pool.query(
        `INSERT INTO budgets (user_id, category, limit_amount) VALUES ($1, $2, $3)`,
        [userId, cat, lim]
      );
    }

    // Sample transactions relative to today
    const today  = new Date();
    const minus  = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; };

    const txRows = [
      ['July Salary',           85000, 'credit', 'Salary & Wages',           'Net Banking',         minus(0), 'HDFC credited'],
      ['Grocery at DMart',       3150, 'debit',  'Food & Dining',             'UPI (GPay/PhonePe)',   minus(0), 'Weekly groceries'],
      ['Electricity Bill',       1680, 'debit',  'Bills & Utilities',         'UPI (GPay/PhonePe)',   minus(1), 'BESCOM July'],
      ['Freelance UI Project',  14500, 'credit', 'Freelance & Side Income',  'UPI (GPay/PhonePe)',   minus(2), 'Logo redesign payment'],
      ['Petrol — Indian Oil',     500, 'debit',  'Travel & Transport',        'Cash',                 minus(2), ''],
      ['Weekend Bistro Lunch',   2200, 'debit',  'Entertainment & Movies',    'Credit Card',          minus(4), 'Friends outing'],
      ['Amazon Shopping',        1870, 'debit',  'Shopping & Clothes',        'Credit Card',          minus(5), 'Earphones'],
    ];

    for (const [title, amount, type, category, method, date, note] of txRows) {
      await pool.query(
        `INSERT INTO transactions (user_id, title, amount, type, category, method, date, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, title, amount, type, category, method, date, note]
      );
    }

    console.log(`  ✅ Demo user seeded`);
    console.log(`     Email:    ${demoEmail}`);
    console.log(`     Password: demo1234`);
  } else {
    console.log('\n  ℹ️  Demo user already exists — skipping seed.');
  }

  await pool.end();
  console.log('\n🚀 Done! Run: node server.js\n');
}

run().catch((err) => {
  console.error('\n❌ init-db failed:', err.message);
  process.exit(1);
});
