/**
 * Vaultly — Express REST API Server
 * Serves the frontend static files + JSON API backed by PostgreSQL
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const path    = require('path');
const db      = require('./database');

const app        = express();
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'vaultly_dev_secret';

app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname)));

// ─────────────────────────────────────────────
// JWT Auth Middleware
// ─────────────────────────────────────────────
function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid. Please log in again.' });
  }
}

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: err.message });
  }
});

// ─────────────────────────────────────────────
// AUTH — REGISTER
// ─────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    const exists = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const hash    = await bcrypt.hash(password, 10);
    const display = name || email.split('@')[0];
    const result  = await db.query(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email`,
      [display, email.toLowerCase(), hash]
    );
    const user = result.rows[0];

    // Insert default budgets for new user
    const defaults = [
      ['Food & Dining', 8000], ['Shopping & Clothes', 5000],
      ['Bills & Utilities', 6000], ['Travel & Transport', 4000],
      ['Entertainment & Movies', 3000]
    ];
    for (const [cat, lim] of defaults) {
      await db.query(
        `INSERT INTO budgets (user_id, category, limit_amount) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [user.id, cat, lim]
      );
    }

    const token = jwt.sign({ userId: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email } });

  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// ─────────────────────────────────────────────
// AUTH — LOGIN
// ─────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required.' });
  }

  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'No account found with that email.' });
    }

    const user  = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// ─────────────────────────────────────────────
// TRANSACTIONS — GET (with optional filters)
// ─────────────────────────────────────────────
app.get('/api/transactions', authRequired, async (req, res) => {
  const { type, category, q } = req.query;
  const userId = req.user.userId;

  let sql    = `SELECT * FROM transactions WHERE user_id = $1`;
  const vals = [userId];
  let idx    = 2;

  if (type && type !== 'all') {
    sql += ` AND type = $${idx++}`;
    vals.push(type);
  }
  if (category && category !== 'all') {
    sql += ` AND category = $${idx++}`;
    vals.push(category);
  }
  if (q) {
    sql += ` AND (title ILIKE $${idx} OR note ILIKE $${idx} OR category ILIKE $${idx})`;
    vals.push(`%${q}%`);
    idx++;
  }

  sql += ` ORDER BY date DESC, created_at DESC`;

  try {
    const result = await db.query(sql, vals);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /transactions error:', err.message);
    res.status(500).json({ error: 'Failed to fetch transactions.' });
  }
});

// ─────────────────────────────────────────────
// TRANSACTIONS — CREATE
// ─────────────────────────────────────────────
app.post('/api/transactions', authRequired, async (req, res) => {
  const { title, amount, type, category, method, date, note } = req.body;
  const userId = req.user.userId;

  if (!title || !amount || !type || !category || !method || !date) {
    return res.status(400).json({ error: 'title, amount, type, category, method, and date are required.' });
  }
  if (!['credit', 'debit'].includes(type)) {
    return res.status(400).json({ error: 'type must be "credit" or "debit".' });
  }
  if (parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'amount must be greater than 0.' });
  }

  try {
    const result = await db.query(
      `INSERT INTO transactions (user_id, title, amount, type, category, method, date, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [userId, title.trim(), parseFloat(amount), type, category, method, date, (note || '').trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /transactions error:', err.message);
    res.status(500).json({ error: 'Failed to create transaction.' });
  }
});

// ─────────────────────────────────────────────
// TRANSACTIONS — UPDATE
// ─────────────────────────────────────────────
app.put('/api/transactions/:id', authRequired, async (req, res) => {
  const { id }     = req.params;
  const userId     = req.user.userId;
  const { title, amount, type, category, method, date, note } = req.body;

  try {
    // Ensure the transaction belongs to this user
    const check = await db.query('SELECT id FROM transactions WHERE id = $1 AND user_id = $2', [id, userId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found.' });
    }

    const result = await db.query(
      `UPDATE transactions
       SET title=$1, amount=$2, type=$3, category=$4, method=$5, date=$6, note=$7
       WHERE id=$8 AND user_id=$9
       RETURNING *`,
      [title.trim(), parseFloat(amount), type, category, method, date, (note || '').trim(), id, userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /transactions error:', err.message);
    res.status(500).json({ error: 'Failed to update transaction.' });
  }
});

// ─────────────────────────────────────────────
// TRANSACTIONS — DELETE
// ─────────────────────────────────────────────
app.delete('/api/transactions/:id', authRequired, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  try {
    const result = await db.query(
      'DELETE FROM transactions WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found.' });
    }
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    console.error('DELETE /transactions error:', err.message);
    res.status(500).json({ error: 'Failed to delete transaction.' });
  }
});

// ─────────────────────────────────────────────
// BUDGETS — GET
// ─────────────────────────────────────────────
app.get('/api/budgets', authRequired, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT category, limit_amount FROM budgets WHERE user_id = $1 ORDER BY category',
      [req.user.userId]
    );
    // Return as { category: limit } map
    const map = {};
    result.rows.forEach(r => { map[r.category] = parseFloat(r.limit_amount); });
    res.json(map);
  } catch (err) {
    console.error('GET /budgets error:', err.message);
    res.status(500).json({ error: 'Failed to fetch budgets.' });
  }
});

// ─────────────────────────────────────────────
// BUDGETS — UPSERT (set/update a single limit)
// ─────────────────────────────────────────────
app.put('/api/budgets', authRequired, async (req, res) => {
  const { category, limit_amount } = req.body;
  const userId = req.user.userId;

  if (!category || limit_amount === undefined || parseFloat(limit_amount) < 0) {
    return res.status(400).json({ error: 'category and a valid limit_amount are required.' });
  }

  try {
    await db.query(
      `INSERT INTO budgets (user_id, category, limit_amount)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, category) DO UPDATE SET limit_amount = EXCLUDED.limit_amount`,
      [userId, category, parseFloat(limit_amount)]
    );
    res.json({ category, limit_amount: parseFloat(limit_amount) });
  } catch (err) {
    console.error('PUT /budgets error:', err.message);
    res.status(500).json({ error: 'Failed to update budget.' });
  }
});

// ─────────────────────────────────────────────
// SPA Fallback — serve index.html for any non-API route
// ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🟢 Vaultly server running at http://localhost:${PORT}`);
  console.log(`   Database: ${process.env.DB_NAME || 'vaultly'} @ ${process.env.DB_HOST || 'localhost'}`);
  console.log(`   Run "node init-db.js" first if this is a fresh setup.\n`);
});
