// Global test setup: mock Tauri IPC so pure-TS functions can be tested
// without a real Tauri runtime.

import { vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

// Stub svelte/store (review-store imports it; not needed for unit tests here)
vi.mock('svelte/store', async () => {
  const actual = await vi.importActual<typeof import('svelte/store')>('svelte/store');
  return actual;
});
