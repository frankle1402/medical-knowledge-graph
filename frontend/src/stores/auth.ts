import { create } from 'zustand';
import type { User } from '@mkg/shared';
import { tokenStorage } from '../lib/api';

interface AuthState {
  token: string | null;
  user: User | null;
  /** True until we've finished hydrating from localStorage / /api/auth/me. */
  initialized: boolean;
  setAuth: (token: string, user: User) => void;
  setUser: (user: User | null) => void;
  setInitialized: (v: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: tokenStorage.get(),
  user: null,
  initialized: false,
  setAuth: (token, user) => {
    tokenStorage.set(token);
    set({ token, user, initialized: true });
  },
  setUser: (user) => set({ user }),
  setInitialized: (v) => set({ initialized: v }),
  logout: () => {
    tokenStorage.clear();
    set({ token: null, user: null, initialized: true });
  },
}));
