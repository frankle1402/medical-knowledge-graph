import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// jsdom has no canvas 2D context, so the real cytoscape constructor blows up
// in `useEffect`. Replace it with a hand-written stub that:
//   - returns 1 for `cy.zoom()` (no args), so `cy.zoom() * factor` is a real
//     number rather than a Proxy-coerced 0;
//   - records `cy.zoom({ level, renderedPosition })` calls so the test can
//     assert the toolbar buttons compute the expected level.
// Only the cy methods that GraphCanvas's effects actually invoke are stubbed
// (verified by reading GraphCanvas.tsx). Hoisted so the mock factory and the
// test body can both reach the spy.
const { cyZoomSpy, makeCy } = vi.hoisted(() => {
  const cyZoomSpy = vi.fn((arg?: unknown) => {
    // Getter form returns a real numeric zoom level.
    if (arg === undefined) return 1;
    // Setter form (object arg): nothing to return, real cy returns the
    // instance for chaining but GraphCanvas does not chain off it.
    return undefined;
  });

  // Cytoscape collections are richly chainable. For our purposes we only need
  // a "looks empty" collection: length 0, no-op iteration, chainable mutators.
  type Collection = {
    length: number;
    filter: ReturnType<typeof vi.fn>;
    forEach: ReturnType<typeof vi.fn>;
    not: ReturnType<typeof vi.fn>;
    addClass: ReturnType<typeof vi.fn>;
    removeClass: ReturnType<typeof vi.fn>;
    unselect: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    data: ReturnType<typeof vi.fn>;
    position: ReturnType<typeof vi.fn>;
    empty: ReturnType<typeof vi.fn>;
    id: ReturnType<typeof vi.fn>;
    isNode: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    closedNeighborhood: ReturnType<typeof vi.fn>;
  };
  const makeCollection = (): Collection => {
    const col = {} as Collection;
    col.length = 0;
    col.filter = vi.fn(() => col);
    col.forEach = vi.fn();
    col.not = vi.fn(() => col);
    col.addClass = vi.fn(() => col);
    col.removeClass = vi.fn(() => col);
    col.unselect = vi.fn(() => col);
    col.select = vi.fn(() => col);
    col.data = vi.fn(() => col);
    col.position = vi.fn(() => ({ x: 0, y: 0 }));
    col.empty = vi.fn(() => true);
    col.id = vi.fn(() => '');
    col.isNode = vi.fn(() => false);
    col.remove = vi.fn(() => col);
    col.closedNeighborhood = vi.fn(() => col);
    return col;
  };

  const makeCy = (opts: { container?: HTMLElement | null } | undefined) => {
    const container = opts?.container ?? null;
    return {
      // Methods invoked by GraphCanvas's effects/handlers:
      container: vi.fn(() => container),
      zoom: cyZoomSpy,
      fit: vi.fn(),
      on: vi.fn(),
      one: vi.fn(),
      destroy: vi.fn(),
      batch: vi.fn((fn: () => void) => fn()),
      add: vi.fn(),
      getElementById: vi.fn(() => makeCollection()),
      nodes: vi.fn(() => makeCollection()),
      elements: vi.fn(() => makeCollection()),
      layout: vi.fn(() => ({ run: vi.fn() })),
      edgehandles: vi.fn(() => ({
        destroy: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      })),
    };
  };

  return { cyZoomSpy, makeCy };
});

vi.mock('cytoscape', () => {
  const cytoscape = vi.fn((opts: { container?: HTMLElement | null } | undefined) => makeCy(opts));
  (cytoscape as unknown as { use: () => void }).use = vi.fn();
  return { default: cytoscape };
});

vi.mock('cytoscape-edgehandles', () => ({ default: () => {} }));
vi.mock('cytoscape-cose-bilkent', () => ({ default: () => {} }));

// Import the component AFTER the mocks are registered.
const { GraphCanvas } = await import('../GraphCanvas');

describe('GraphCanvas zoom buttons', () => {
  const noop = () => {};
  const baseProps = {
    nodes: [],
    relations: [],
    selectedNodeId: null,
    positions: new Map<string, { x: number; y: number }>(),
    onSelectNode: noop,
    onSelectRelation: noop,
    onCanvasDoubleClick: noop,
    onConnect: noop,
    onDeleteNode: noop,
    onPositionChange: noop,
  };

  it('renders + and − buttons next to the existing toolbar', () => {
    render(<GraphCanvas {...baseProps} />);
    expect(screen.getByTestId('canvas-auto-layout')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-fit-view')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-zoom-in')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-zoom-out')).toBeInTheDocument();
  });

  it('clicking + does not throw even before cytoscape mounts', async () => {
    render(<GraphCanvas {...baseProps} />);
    await userEvent.click(screen.getByTestId('canvas-zoom-in'));
    await userEvent.click(screen.getByTestId('canvas-zoom-out'));
  });

  it('clicking + calls cy.zoom with a higher level than clicking −', async () => {
    render(<GraphCanvas {...baseProps} />);
    // Drop any zoom() calls the init effect may have made (it doesn't today,
    // but we want this assertion to be about the buttons, full stop).
    cyZoomSpy.mockClear();

    await userEvent.click(screen.getByTestId('canvas-zoom-in'));
    await userEvent.click(screen.getByTestId('canvas-zoom-out'));

    // Only the setter calls (object arg) are interesting; getter calls
    // (`cy.zoom()`) come from `zoomBy`'s `cy.zoom() * factor` and we ignore
    // them here.
    const setterCalls = cyZoomSpy.mock.calls.filter(
      (c): c is [{ level: number; renderedPosition: { x: number; y: number } }] =>
        typeof c[0] === 'object' && c[0] !== null,
    );
    expect(setterCalls).toHaveLength(2);
    const zoomInArg = setterCalls[0]?.[0];
    const zoomOutArg = setterCalls[1]?.[0];
    expect(zoomInArg?.level).toBeCloseTo(1.2);
    expect(zoomOutArg?.level).toBeCloseTo(1 / 1.2);
  });
});
