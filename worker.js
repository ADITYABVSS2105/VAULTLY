import { httpServerHandler } from 'cloudflare:node';

let appHandler = null;

export default {
  async fetch(request, env, ctx) {
    // Copy Cloudflare environment variables (like DATABASE_URL, JWT_SECRET) to process.env
    // so that standard Node.js libraries (pg, jwt) can access them.
    if (env) {
      for (const [key, val] of Object.entries(env)) {
        if (typeof val === 'string') {
          process.env[key] = val;
        }
      }
    }

    // Lazily load the Express app so that module-level initialization reads the env variables
    if (!appHandler) {
      const { default: app } = await import('./server.js');
      appHandler = httpServerHandler(app);
    }

    // httpServerHandler returns a standard Cloudflare Worker export with a fetch handler.
    if (typeof appHandler === 'function') {
      return appHandler({ request, env, waitUntil: ctx.waitUntil.bind(ctx) });
    }
    return appHandler.fetch(request, env, ctx);
  }
};
