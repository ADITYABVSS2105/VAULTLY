/**
 * Vaultly — Cloudflare Worker (Edge-native API)
 *
 * This file is the ONLY backend that runs on Cloudflare Workers.
 * It does NOT use Express, pg, dotenv, path, or any Node-only module.
 * Static files (index.html, style.css, app.js) are served by
 * Cloudflare's `assets` binding automatically.
 *
 * Dependencies (edge-safe):
 *   @neondatabase/serverless — PostgreSQL over WebSockets
 *   bcryptjs — pure-JS bcrypt (no native bindings)
 *   jose — JWT sign/verify for edge runtimes
 */

import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';

// ─── Helpers ────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function cors() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function getSecret(env) {
  const raw = env.JWT_SECRET || 'vaultly_dev_secret';
  return new TextEncoder().encode(raw);
}

async function signToken(payload, env) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(getSecret(env));
}

async function verifyToken(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try {
    const { payload } = await jwtVerify(auth.slice(7), getSecret(env));
    return payload;
  } catch {
    return null;
  }
}

// ─── Router ─────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    // CORS preflight
    if (method === 'OPTIONS') return cors();

    // Only handle /api/* routes — everything else falls through to static assets
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

    // Verify DATABASE_URL exists in the environment
    if (!env.DATABASE_URL) {
      return json({
        error: 'DATABASE_URL is missing. Please add it to your Cloudflare Worker environment variables.',
        help: 'Go to Cloudflare Dashboard -> Workers & Pages -> vaultly -> Settings -> Variables and add DATABASE_URL'
      }, 500);
    }

    // Create a Neon SQL function for this request
    const sql = neon(env.DATABASE_URL);

    try {
      // ── Health ──
      if (path === '/api/health' && method === 'GET') {
        await sql`SELECT 1`;
        return json({ status: 'ok', db: 'connected' });
      }

      // ── Register ──
      if (path === '/api/auth/register' && method === 'POST') {
        const { name, email, password } = await request.json();
        if (!email || !password) return json({ error: 'Email and password are required.' }, 400);
        if (password.length < 6) return json({ error: 'Password must be at least 6 characters.' }, 400);

        const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
        if (existing.length > 0) return json({ error: 'An account with this email already exists.' }, 409);

        const hash = await bcrypt.hash(password, 10);
        const display = name || email.split('@')[0];
        const rows = await sql`
          INSERT INTO users (name, email, password_hash)
          VALUES (${display}, ${email.toLowerCase()}, ${hash})
          RETURNING id, name, email
        `;
        const user = rows[0];

        // Default budgets
        const budgets = [
          ['Food & Dining', 8000], ['Shopping & Clothes', 5000],
          ['Bills & Utilities', 6000], ['Travel & Transport', 4000],
          ['Entertainment & Movies', 3000],
        ];
        for (const [cat, lim] of budgets) {
          await sql`INSERT INTO budgets (user_id, category, limit_amount)
                    VALUES (${user.id}, ${cat}, ${lim}) ON CONFLICT DO NOTHING`;
        }

        const token = await signToken({ userId: user.id, email: user.email, name: user.name }, env);
        return json({ token, user: { id: user.id, name: user.name, email: user.email } }, 201);
      }

      // ── Login ──
      if (path === '/api/auth/login' && method === 'POST') {
        const { email, password } = await request.json();
        if (!email || !password) return json({ error: 'Email and password required.' }, 400);

        const rows = await sql`SELECT * FROM users WHERE email = ${email.toLowerCase()}`;
        if (rows.length === 0) return json({ error: 'No account found with that email.' }, 401);

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return json({ error: 'Incorrect password.' }, 401);

        const token = await signToken({ userId: user.id, email: user.email, name: user.name }, env);
        return json({ token, user: { id: user.id, name: user.name, email: user.email } });
      }

      // ── Protected routes below ──
      const auth = await verifyToken(request, env);
      if (!auth) return json({ error: 'Missing or invalid Authorization header' }, 401);
      const userId = auth.userId;

      // ── GET Transactions ──
      if (path === '/api/transactions' && method === 'GET') {
        const type = url.searchParams.get('type');
        const category = url.searchParams.get('category');
        const q = url.searchParams.get('q');

        // Build dynamic query with tagged templates
        let rows;
        if (type && type !== 'all' && category && category !== 'all' && q) {
          rows = await sql`SELECT * FROM transactions WHERE user_id = ${userId}
            AND type = ${type} AND category = ${category}
            AND (title ILIKE ${'%' + q + '%'} OR note ILIKE ${'%' + q + '%'} OR category ILIKE ${'%' + q + '%'})
            ORDER BY date DESC, created_at DESC`;
        } else if (type && type !== 'all' && category && category !== 'all') {
          rows = await sql`SELECT * FROM transactions WHERE user_id = ${userId}
            AND type = ${type} AND category = ${category}
            ORDER BY date DESC, created_at DESC`;
        } else if (type && type !== 'all' && q) {
          rows = await sql`SELECT * FROM transactions WHERE user_id = ${userId}
            AND type = ${type}
            AND (title ILIKE ${'%' + q + '%'} OR note ILIKE ${'%' + q + '%'} OR category ILIKE ${'%' + q + '%'})
            ORDER BY date DESC, created_at DESC`;
        } else if (category && category !== 'all' && q) {
          rows = await sql`SELECT * FROM transactions WHERE user_id = ${userId}
            AND category = ${category}
            AND (title ILIKE ${'%' + q + '%'} OR note ILIKE ${'%' + q + '%'} OR category ILIKE ${'%' + q + '%'})
            ORDER BY date DESC, created_at DESC`;
        } else if (type && type !== 'all') {
          rows = await sql`SELECT * FROM transactions WHERE user_id = ${userId}
            AND type = ${type} ORDER BY date DESC, created_at DESC`;
        } else if (category && category !== 'all') {
          rows = await sql`SELECT * FROM transactions WHERE user_id = ${userId}
            AND category = ${category} ORDER BY date DESC, created_at DESC`;
        } else if (q) {
          rows = await sql`SELECT * FROM transactions WHERE user_id = ${userId}
            AND (title ILIKE ${'%' + q + '%'} OR note ILIKE ${'%' + q + '%'} OR category ILIKE ${'%' + q + '%'})
            ORDER BY date DESC, created_at DESC`;
        } else {
          rows = await sql`SELECT * FROM transactions WHERE user_id = ${userId}
            ORDER BY date DESC, created_at DESC`;
        }

        return json(rows);
      }

      // ── POST Transaction ──
      if (path === '/api/transactions' && method === 'POST') {
        const { title, amount, type, category, method: payMethod, date, note } = await request.json();
        if (!title || !amount || !type || !category || !payMethod || !date)
          return json({ error: 'title, amount, type, category, method, and date are required.' }, 400);
        if (!['credit', 'debit'].includes(type))
          return json({ error: 'type must be "credit" or "debit".' }, 400);
        if (parseFloat(amount) <= 0)
          return json({ error: 'amount must be greater than 0.' }, 400);

        const rows = await sql`
          INSERT INTO transactions (user_id, title, amount, type, category, method, date, note)
          VALUES (${userId}, ${title.trim()}, ${parseFloat(amount)}, ${type}, ${category}, ${payMethod}, ${date}, ${(note || '').trim()})
          RETURNING *
        `;
        return json(rows[0], 201);
      }

      // ── PUT Transaction ──
      const txMatch = path.match(/^\/api\/transactions\/(\d+)$/);
      if (txMatch && method === 'PUT') {
        const id = parseInt(txMatch[1]);
        const { title, amount, type, category, method: payMethod, date, note } = await request.json();

        const check = await sql`SELECT id FROM transactions WHERE id = ${id} AND user_id = ${userId}`;
        if (check.length === 0) return json({ error: 'Transaction not found.' }, 404);

        const rows = await sql`
          UPDATE transactions
          SET title=${title.trim()}, amount=${parseFloat(amount)}, type=${type},
              category=${category}, method=${payMethod}, date=${date}, note=${(note || '').trim()}
          WHERE id=${id} AND user_id=${userId}
          RETURNING *
        `;
        return json(rows[0]);
      }

      // ── DELETE Transaction ──
      if (txMatch && method === 'DELETE') {
        const id = parseInt(txMatch[1]);
        const rows = await sql`DELETE FROM transactions WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
        if (rows.length === 0) return json({ error: 'Transaction not found.' }, 404);
        return json({ deleted: true, id: rows[0].id });
      }

      // ── GET Budgets ──
      if (path === '/api/budgets' && method === 'GET') {
        const rows = await sql`SELECT category, limit_amount FROM budgets WHERE user_id = ${userId} ORDER BY category`;
        const map = {};
        rows.forEach(r => { map[r.category] = parseFloat(r.limit_amount); });
        return json(map);
      }

      // ── PUT Budget ──
      if (path === '/api/budgets' && method === 'PUT') {
        const { category, limit_amount } = await request.json();
        if (!category || limit_amount === undefined || parseFloat(limit_amount) < 0)
          return json({ error: 'category and a valid limit_amount are required.' }, 400);

        await sql`
          INSERT INTO budgets (user_id, category, limit_amount)
          VALUES (${userId}, ${category}, ${parseFloat(limit_amount)})
          ON CONFLICT (user_id, category) DO UPDATE SET limit_amount = EXCLUDED.limit_amount
        `;
        return json({ category, limit_amount: parseFloat(limit_amount) });
      }

      // ── 404 fallback for unmatched API routes ──
      return json({ error: 'Not found' }, 404);

    } catch (err) {
      console.error('Worker error:', err);
      return json({ error: 'Internal server error', details: err.message }, 500);
    }
  },
};
