'use client';

import { api } from '@/lib/api';
import { User } from '@/types';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api.getProfile()
      .then(setUser)
      .catch((error) => {
        // Only logout on auth errors, NOT on network/server errors
        const msg = error.message?.toLowerCase();
        if (msg?.includes('401') || msg?.includes('unauthorized') || msg?.includes('session expired')) {
          console.error('Auth check failed, logging out:', error);
          api.logout();
          setUser(null);
        } else {
          console.warn('Profile fetch failed but keeping session (transient error):', error);
          // Optionally could set a "disconnected" state here
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const response = await api.login(username, password);
    setUser(response.user);
  };

  const logout = () => {
    api.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated: !!user,
      login,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
