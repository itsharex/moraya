/**
 * Unit tests for lock-service.ts
 *
 * Covers:
 *  - isExpired() × 2 cases (expired / not expired)
 */

import { describe, it, expect } from 'vitest';
import { isExpired } from './lock-service';
import type { Lock } from './types';

function makeLock(expiresAt: string): Lock {
  return {
    lockedBy: 'alice',
    lockedByEmail: 'alice@example.com',
    lockedAt: '2026-01-01T00:00:00Z',
    expiresAt,
  };
}

describe('isExpired', () => {
  it('returns true for a lock that expired in the past', () => {
    const lock = makeLock('2020-01-01T00:00:00Z'); // well in the past
    expect(isExpired(lock)).toBe(true);
  });

  it('returns false for a lock that expires in the future', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now
    const lock = makeLock(future);
    expect(isExpired(lock)).toBe(false);
  });
});
