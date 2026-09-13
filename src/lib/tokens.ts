import crypto from 'crypto';
import { config } from '../config.js';

function resolveSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;

  if (config.nodeEnv === 'production') {
    throw new Error(
      'JWT_SECRET must be set to a random value of at least 32 characters in production. ' +
        'Refusing to start with a missing/weak/default secret.'
    );
  }

  if (fromEnv) {
    console.warn('⚠️  JWT_SECRET is shorter than 32 characters — fine for local dev, not for production.');
    return fromEnv;
  }

  console.warn('⚠️  JWT_SECRET not set — using an ephemeral dev-only secret (tokens invalidate on restart).');
  return crypto.randomBytes(32).toString('hex');
}

const SECRET = resolveSecret();

type TokenPayload = {
  sub: string;
  role: string;
  schoolId: string | null;
  jti?: string;
  exp: number;
  iat: number;
};

function b64url(input: string | Buffer) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromB64url(input: string) {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
}

export function signAccessToken(
  user: { id: string; role: string; schoolId: string | null },
  expiresInSec = 60 * 60 * 24 * 7,
  sessionId?: string
) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sub: user.id,
    role: user.role,
    schoolId: user.schoolId,
    ...(sessionId ? { jti: sessionId } : {}),
    iat: now,
    exp: now + expiresInSec,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    const payload = JSON.parse(fromB64url(body)) as TokenPayload;
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
