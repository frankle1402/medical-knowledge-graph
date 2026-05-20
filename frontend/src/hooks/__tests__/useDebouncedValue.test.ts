import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDebouncedValue } from '../useDebouncedValue';

describe('useDebouncedValue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the initial value synchronously', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDebouncedValue(0.92, 300));
    expect(result.current).toBe(0.92);
  });

  it('updates only after the delay elapses', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }: { value: number }) => useDebouncedValue(value, 300),
      { initialProps: { value: 0.92 } },
    );
    rerender({ value: 0.95 });
    expect(result.current).toBe(0.92);
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe(0.92);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(0.95);
  });

  it('coalesces rapid changes to a single final update', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }: { value: number }) => useDebouncedValue(value, 300),
      { initialProps: { value: 0.85 } },
    );
    // Simulate slider drag — value changes every 50ms across 250ms total.
    for (const v of [0.86, 0.87, 0.88, 0.89, 0.9]) {
      act(() => {
        vi.advanceTimersByTime(50);
      });
      rerender({ value: v });
    }
    // No update yet — last change just happened.
    expect(result.current).toBe(0.85);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe(0.9);
  });
});
