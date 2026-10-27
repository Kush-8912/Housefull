import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, clearDb, app, signUp, TEST_PASSWORD } from './helpers.js';
import { AppError } from '../src/utils/AppError.js';
import { verifyGoogleAccessToken } from '../src/services/googleToken.js';

// The token check with Google is covered in googleToken.test.js; here it
// answers with whatever profile the test sets up.
vi.mock('../src/services/googleToken.js', () => ({ verifyGoogleAccessToken: vi.fn() }));

beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await clearDb();
  vi.mocked(verifyGoogleAccessToken).mockReset();
});

const asGoogle = (profile) => vi.mocked(verifyGoogleAccessToken).mockResolvedValue({ googleId: 'g-123', email: 'meera@gmail.com', name: 'Meera K', ...profile });
const google = (agent, body = {}) => agent.post('/api/auth/google').send({ accessToken: 'access-token', ...body });

describe('Continue with Google', () => {
  it('tells the client which client ID to use', async () => {
    const { body } = await request(app).get('/api/auth/providers').expect(200);
    expect(body.google).toBe('test-client.apps.googleusercontent.com');
  });

  it('creates an account on first sign-in, then signs the same person back in', async () => {
    asGoogle();
    const agent = request.agent(app);
    const first = await google(agent, { role: 'organizer' }).expect(201);
    expect(first.body.created).toBe(true);
    expect(first.body.user).toMatchObject({ email: 'meera@gmail.com', name: 'Meera K', role: 'organizer', hasPassword: false });
    expect(first.body.user.googleId).toBeUndefined();
    await agent.get('/api/auth/me').expect(200);

    // Even if they say "attendee" now, a returning user keeps their role.
    const again = await google(request.agent(app), { role: 'attendee' }).expect(200);
    expect(again.body).toMatchObject({ created: false, user: { _id: first.body.user._id, role: 'organizer' } });
  });

  it('links Google to an existing password account with the same email', async () => {
    const { user } = await signUp('attendee');
    asGoogle({ email: user.email });
    const { body } = await google(request.agent(app)).expect(200);
    expect(body.user._id).toBe(user._id);
    expect(body.user.hasPassword).toBe(true);
    // The password still works too.
    await request(app).post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
  });

  it('turns away a token Google won’t vouch for', async () => {
    vi.mocked(verifyGoogleAccessToken).mockRejectedValue(new AppError(401, 'Google sign-in didn’t go through. Please try again.', { code: 'GOOGLE_TOKEN_INVALID' }));
    const { body } = await google(request.agent(app)).expect(401);
    expect(body.error.code).toBe('GOOGLE_TOKEN_INVALID');
  });

  it('keeps Google-only accounts out of the password flows without crashing', async () => {
    asGoogle();
    const agent = request.agent(app);
    await google(agent).expect(201);
    const login = await request(app).post('/api/auth/login').send({ email: 'meera@gmail.com', password: 'anything' }).expect(401);
    expect(login.body.error.code).toBe('BAD_CREDENTIALS');
    const change = await agent.post('/api/auth/password').send({ currentPassword: 'x', newPassword: 'NewPass123!' }).expect(400);
    expect(change.body.error.code).toBe('NO_PASSWORD');
  });
});
