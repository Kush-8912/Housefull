import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, clearDb, app, signUp, eventPayload, TEST_HOST } from './helpers.js';
import { verifyPan } from '../src/services/kycService.js';

const code = async (promise) => (await promise.catch((e) => e)).code;

describe('demo PAN check', () => {
  it('accepts a PAN whose 5th letter is the surname initial (person) or name initial (company)', async () => {
    expect(await verifyPan({ pan: 'ABCPS1234K', legalName: 'Riya Sharma' })).toEqual({ holderType: 'person', panLast4: '234K' });
    expect(await verifyPan({ pan: 'ABCCH5678L', legalName: 'Housefull Live Pvt Ltd' })).toMatchObject({ holderType: 'company' });
  });

  it('rejects malformed PANs and unknown holder types', async () => {
    expect(await code(verifyPan({ pan: 'ABCPS12345', legalName: 'Riya Sharma' }))).toBe('PAN_INVALID');
    expect(await code(verifyPan({ pan: 'ABCXS1234K', legalName: 'Riya Sharma' }))).toBe('PAN_INVALID');
  });

  it('catches a PAN typed against the wrong name, and the provider’s failure modes', async () => {
    expect(await code(verifyPan({ pan: 'ABCPK1234K', legalName: 'Riya Sharma' }))).toBe('PAN_NAME_MISMATCH');
    expect(await code(verifyPan({ pan: 'AAAPZ0000Z', legalName: 'Zoya Zaidi' }))).toBe('PAN_NOT_FOUND');
    expect(await code(verifyPan({ pan: 'AAAPZ9999Z', legalName: 'Zoya Zaidi' }))).toBe('KYC_UNAVAILABLE');
  });
});

describe('host verification', () => {
  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(clearDb);

  it('blocks publishing until the organizer is verified, then lets it through', async () => {
    const org = await signUp('organizer', { verified: false });
    expect(org.user.verifiedHost).toBe(false);
    const { body } = await org.agent.post('/api/events').send(eventPayload()).expect(201);
    const blocked = await org.agent.post(`/api/events/${body.event.id}/publish`).expect(403);
    expect(blocked.body.error.code).toBe('HOST_NOT_VERIFIED');

    const verified = await org.agent.post('/api/auth/me/host-verification').send({ ...TEST_HOST, pan: 'abcpo1234k' }).expect(200);
    expect(verified.body.user).toMatchObject({ verifiedHost: true, hostVerification: { legalName: 'Test Organiser', panLast4: '234K', holderType: 'person' } });
    expect(JSON.stringify(verified.body)).not.toContain('ABCPO1234K'); // only the last 4 are kept
    await org.agent.post(`/api/events/${body.event.id}/publish`).expect(200);

    // Buyers see that the host is verified.
    const detail = await request(app).get(`/api/events/${body.event.id}`).expect(200);
    expect(detail.body.event.organizer.verifiedHost).toBe(true);
    await org.agent.post('/api/auth/me/host-verification').send(TEST_HOST).expect(409);
  });

  it('explains failures on the right field and keeps the host unverified', async () => {
    const org = await signUp('organizer', { verified: false });
    const mismatch = await org.agent.post('/api/auth/me/host-verification').send({ legalName: 'Riya Sharma', pan: 'ABCPK1234K' }).expect(422);
    expect(mismatch.body.error).toMatchObject({ code: 'PAN_NAME_MISMATCH', details: [{ field: 'legalName' }] });
    await org.agent.post('/api/auth/me/host-verification').send({ legalName: 'Riya Sharma', pan: 'AAAPZ9999Z' }).expect(503);
    const me = await org.agent.get('/api/auth/me').expect(200);
    expect(me.body.user.verifiedHost).toBe(false);
  });

  it('is only for organizers', async () => {
    const buyer = await signUp('attendee');
    await buyer.agent.post('/api/auth/me/host-verification').send(TEST_HOST).expect(403);
  });
});
