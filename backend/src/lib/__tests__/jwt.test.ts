import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { signToken, verifyToken } from '../jwt';
import { env } from '../../config/env';

describe('jwt utilities', () => {
  it('signs and verifies returning the same payload (sub form)', () => {
    const t = signToken({ sub: 'user-1', username: 'admin', role: 'admin' });
    const p = verifyToken(t);
    expect(p.sub).toBe('user-1');
    expect(p.id).toBe('user-1');
    expect(p.role).toBe('admin');
    expect(p.username).toBe('admin');
  });

  it('signs with id alias as a substitute for sub', () => {
    const t = signToken({ id: 'user-2', role: 'operator' });
    const p = verifyToken(t);
    expect(p.id).toBe('user-2');
    expect(p.sub).toBe('user-2');
    expect(p.role).toBe('operator');
  });

  it('throws when neither sub nor id is provided to signToken', () => {
    expect(() => signToken({ role: 'admin' } as never)).toThrow(/sub or id/);
  });

  it('throws on tampered token', () => {
    expect(() => verifyToken('not-a-token')).toThrow();
  });

  it('throws when role is missing in token payload', () => {
    const bad = jwt.sign({ sub: 'x' }, env.JWT_SECRET);
    expect(() => verifyToken(bad)).toThrow(/role/);
  });

  it('throws when sub/id missing in decoded payload', () => {
    const bad = jwt.sign({ role: 'admin' }, env.JWT_SECRET);
    expect(() => verifyToken(bad)).toThrow(/sub\/id/);
  });
});
