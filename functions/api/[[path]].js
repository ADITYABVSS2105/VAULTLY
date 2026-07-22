import { httpServerHandler } from 'cloudflare:node';

let appHandler = null;

export const onRequest = async (context) => {
  // Copy environment variables from Cloudflare Pages context to process.env
  // so that standard Node.js libraries (pg, jwt) can access them.
  if (context.env) {
    for (const [key, val] of Object.entries(context.env)) {
      if (typeof val === 'string') {
        process.env[key] = val;
      }
    }
  }

  // Lazily import the Express app only after process.env has been populated.
  // This guarantees that module-level initialization (like the database pool
  // and JWT secrets) correctly reads the Cloudflare environment variables.
  if (!appHandler) {
    const { default: app } = await import('../../server.js');
    appHandler = httpServerHandler(app);
  }

  return appHandler(context);
};
