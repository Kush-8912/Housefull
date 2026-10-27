/**
 * Mock PAN verification standing in for a licensed KYC provider (or the
 * DigiLocker / Income Tax PAN APIs they wrap). Like paymentService, it keeps a
 * real provider's contract — PAN + name in, verified or a typed failure out —
 * so going live only touches this file. Aadhaar is deliberately not used:
 * checking it needs a UIDAI licence and storing it carries strict rules, and
 * platforms that pay organizers verify PAN (plus a bank account) anyway.
 *
 * The checks a provider would do that we can do offline:
 *   - format: 5 letters, 4 digits, 1 letter (ABCPE1234F)
 *   - the 4th letter is a valid holder type (P person, C company, F firm, ...)
 *   - the 5th letter is the first letter of the surname (for a person) or of
 *     the name (for anyone else), which catches a PAN typed against the wrong name
 *
 * Test PANs:
 *   AAAPZ0000Z  not found
 *   AAAPZ9999Z  provider unavailable
 */
export class KycError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const HOLDER_TYPES = { P: 'person', C: 'company', H: 'Hindu undivided family', F: 'firm', A: 'association', T: 'trust', B: 'body of individuals', L: 'local authority', J: 'artificial juridical person', G: 'government' };

const LATENCY_MS = process.env.NODE_ENV === 'test' ? 0 : 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The letter the PAN's 5th character has to match for this name.
const nameInitial = (legalName, type) => {
  const words = legalName.toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(Boolean);
  return (type === 'P' ? words.at(-1) : words[0])?.[0];
};

export async function verifyPan({ pan, legalName }) {
  await sleep(LATENCY_MS);
  if (!PAN_PATTERN.test(pan) || !HOLDER_TYPES[pan[3]]) {
    throw new KycError('PAN_INVALID', 'That isn’t a valid PAN. It looks like ABCPE1234F.');
  }
  if (pan === 'AAAPZ9999Z') throw new KycError('KYC_UNAVAILABLE', 'The verification service is down. Please try again in a few minutes.');
  if (pan === 'AAAPZ0000Z') throw new KycError('PAN_NOT_FOUND', 'No PAN with that number was found.');
  if (pan[4] !== nameInitial(legalName, pan[3])) {
    throw new KycError('PAN_NAME_MISMATCH', pan[3] === 'P'
      ? 'This PAN doesn’t match that name. Use your name exactly as it is on your PAN card.'
      : 'This PAN doesn’t match that organisation name.');
  }
  return { holderType: HOLDER_TYPES[pan[3]], panLast4: pan.slice(-4) };
}
