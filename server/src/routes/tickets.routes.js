import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { transferTicket } from '../services/transferService.js';
import { checkInByCode } from '../services/checkinService.js';

// Mounted at /api/tickets
export const ticketsRouter = Router();

const params = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id') });

ticketsRouter.post('/:id/transfer', requireAuth, validate(params, 'params'), validate(z.object({ email: z.email('Enter a valid email') })), asyncHandler(async (req, res) => {
  const result = await transferTicket({ user: req.user, ticketId: req.params.id, email: req.body.email });
  res.json(result);
}));

// Where a scan link lands: the event comes from the ticket itself, so a guard
// can point any phone camera at a QR without opening the right event first.
ticketsRouter.post('/checkin', requireAuth, requireRole('organizer'), validate(z.object({ qr: z.string().trim().min(1, 'Scan or enter a ticket code').max(300) })), asyncHandler(async (req, res) => {
  res.json({ checkin: await checkInByCode({ qr: req.body.qr, staff: req.user }) });
}));
