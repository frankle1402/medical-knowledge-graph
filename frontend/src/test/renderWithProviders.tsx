import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

export function renderWithProviders(
  ui: ReactElement,
  opts: { route?: string } & Omit<RenderOptions, 'wrapper'> = {},
) {
  const { route = '/', ...rest } = opts;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
  );
  return render(ui, { wrapper: Wrapper, ...rest });
}
