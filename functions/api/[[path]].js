import { httpServerHandler } from 'cloudflare:node';
import app from '../../server.js';

export const onRequest = httpServerHandler(app);
