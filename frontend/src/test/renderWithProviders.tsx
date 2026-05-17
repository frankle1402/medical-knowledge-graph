import { render, type RenderOptions } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

export function renderWithProviders(
  ui: ReactElement,
  opts: { route?: string; reactFlow?: boolean } & Omit<RenderOptions, 'wrapper'> = {},
) {
  const { route = '/', reactFlow = false, ...rest } = opts;
  const Wrapper = ({ children }: { children: ReactNode }) => {
    const inner = reactFlow ? <ReactFlowProvider>{children}</ReactFlowProvider> : children;
    return <MemoryRouter initialEntries={[route]}>{inner}</MemoryRouter>;
  };
  return render(ui, { wrapper: Wrapper, ...rest });
}
