require('dotenv').config();

let Pool;

// Detect if we are running in a Cloudflare Worker environment
const isWorker = typeof globalThis.WebSocket !== 'undefined' && typeof globalThis.navigator === 'undefined';

if (isWorker || (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon.tech'))) {
  // Use Neon serverless driver designed for serverless edge runtimes (connects over WebSockets)
  const { Pool: NeonPool, neonConfig } = require('@neondatabase/serverless');
  
  if (typeof globalThis.WebSocket !== 'undefined') {
    neonConfig.webSocketConstructor = globalThis.WebSocket;
  }
  
  Pool = NeonPool;
  console.log('🔌 database: using @neondatabase/serverless driver');
} else {
  // Use standard pg driver for traditional Node.js environments (connects over TCP)
  Pool = require('pg').Pool;
  console.log('🔌 database: using standard pg driver');
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Required for secure TLS connections
    })
  : new Pool({
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME     || 'vaultly',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    });

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
