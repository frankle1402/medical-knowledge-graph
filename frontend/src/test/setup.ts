import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

beforeEach(() => {
  // Each test gets a fresh localStorage
  globalThis.localStorage?.clear();
});

afterEach(() => {
  cleanup();
});
