'use client';

import { api } from '@/lib/api';
import { RegisterPayload, RegisterWithGooglePayload, User } from '@/types';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  register: (payload: RegisterPayload) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  registerWithGoogle: (
    idToken: string,
    registration: RegisterWithGooglePayload,
  ) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api.getProfile()
      .then((profile) => {
        if (profile.role !== 'STUDENT') {
          api.logout();
          setUser(null);
          return;
        }

        setUser(profile);
      })
      .catch((error) => {
        // Only logout on auth errors, NOT on network/server errors
        const msg = error.message?.toLowerCase();
        if (msg?.includes('401') || msg?.includes('unauthorized') || msg?.includes('session expired')) {
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

    if (response.user.role !== 'STUDENT') {
      api.logout();
      throw new Error('This portal is for student accounts only');
    }

    setUser(response.user);
  };

  const register = async (payload: RegisterPayload) => {
    const response = await api.register(payload);

    if (response.user.role !== 'STUDENT') {
      api.logout();
      throw new Error('This portal is for student accounts only');
    }

    setUser(response.user);
  };

  const registerWithGoogle = async (
    idToken: string,
    registration: RegisterWithGooglePayload,
  ) => {
    const response = await api.registerWithGoogle(idToken, registration);

    if (response.user.role !== 'STUDENT') {
      api.logout();
      throw new Error('This portal is for student accounts only');
    }

    setUser(response.user);
  };

  const loginWithGoogle = async (idToken: string) => {
    const response = await api.loginWithGoogle(idToken);

    if (response.user.role !== 'STUDENT') {
      api.logout();
      throw new Error('This portal is for student accounts only');
    }

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
      register,
      login,
      registerWithGoogle,
      loginWithGoogle,
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
