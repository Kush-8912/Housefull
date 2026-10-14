import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { env, isProd } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiRouter } from './routes/index.js';
import { Event } from './models/Event.js';
import { renderEventPage } from './services/sharePreview.js';

const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // behind Render's proxy: needed for secure cookies + rate limiting by real IP
  app.use(helmet({
    contentSecurityPolicy: isProd
      ? {
          directives: {
            // Organizers can use any HTTPS image as an event cover.
            'img-src': ["'self'", 'data:', 'https:'],
            // Same-origin websocket for live seat updates.
            'connect-src': ["'self'", 'wss:', 'ws:'],
          },
        }
      : false,
  }));
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (env.NODE_ENV === 'development') app.use(morgan('dev'));

  app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, skip: () => env.NODE_ENV === 'test', standardHeaders: 'draft-8', legacyHeaders: false }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'up' : 'down' });
  });
  app.use('/api', apiRouter);
  app.use('/api', notFoundHandler);

  // In production the API also serves the built React app, so the whole
  // product is one origin: no cross-site cookie or CORS configuration needed.
  if (isProd && fs.existsSync(clientDist)) {
    const indexHtml = fs.readFileSync(path.join(clientDist, 'index.html'), 'utf8');
    // Event links get their own title, description and image for link previews.
    app.get('/events/:id', async (req, res, next) => {
      try {
        const event = /^[a-f\d]{24}$/i.test(req.params.id) ? await Event.findById(req.params.id, 'title startsAt venue coverImageUrl status') : null;
        if (!event || event.status === 'draft') return next();
        res.set('Cache-Control', 'no-cache').type('html').send(renderEventPage(indexHtml, event, env.APP_URL));
      } catch (err) {
        next(err);
      }
    });
    app.use(express.static(clientDist, { maxAge: '1h', index: false }));
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
