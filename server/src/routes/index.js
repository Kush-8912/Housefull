import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { eventsRouter } from './events.routes.js';
import { eventHoldsRouter, holdsRouter } from './holds.routes.js';
import { checkoutRouter, ordersRouter } from './orders.routes.js';
import { organizerEventRouter } from './organizer.routes.js';
import { ticketsRouter } from './tickets.routes.js';
import { notificationsRouter } from './notifications.routes.js';
import { usersRouter } from './users.routes.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/events/:id/holds', eventHoldsRouter);
apiRouter.use('/events', organizerEventRouter);
apiRouter.use('/events', eventsRouter);
apiRouter.use('/holds/:id/checkout', checkoutRouter);
apiRouter.use('/holds', holdsRouter);
apiRouter.use('/orders', ordersRouter);
apiRouter.use('/tickets', ticketsRouter);
apiRouter.use('/notifications', notificationsRouter);
apiRouter.use('/users', usersRouter);
