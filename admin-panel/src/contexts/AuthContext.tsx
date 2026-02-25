'use client';

import { api } from '@/lib/api';
import { ADMIN_QUERY_TIMINGS } from '@/lib/query/config';
import { adminQueryKeys } from '@/lib/query/keys';
import { Role, User } from '@/types';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const logoutTriggered = useRef(false);

  const profileQuery = useQuery({
    queryKey: adminQueryKeys.authProfile(),
    queryFn: ({ signal }) => api.getProfile({ signal }),
    staleTime: ADMIN_QUERY_TIMINGS.profile.staleTime,
    gcTime: ADMIN_QUERY_TIMINGS.profile.gcTime,
    retry: (failureCount, error) => {
      // Never retry auth errors
      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('forbidden')) {
          return false;
        }
      }
      return failureCount < 2;
    },
  });

  // Derive auth state directly from the query — no intermediate useState
  // This eliminates the race condition where isPending=false but sessionUser
  // hasn't been set yet by a useEffect.
  const user: User | null = profileQuery.data ?? null;
  const isLoading = profileQuery.isPending;
  const isAuthenticated = !!user;

  // Handle auth errors: clear token when we get a definitive auth failure
  useEffect(() => {
    if (profileQuery.isError && !logoutTriggered.current) {
      const error = profileQuery.error;
      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        const isAuthError =
          msg.includes('401') ||
          msg.includes('403') ||
          msg.includes('unauthorized') ||
          msg.includes('forbidden') ||
          msg.includes('session expired');
        if (isAuthError) {
          logoutTriggered.current = true;
          api.logout();
          queryClient.removeQueries({ queryKey: adminQueryKeys.authProfile() });
        }
      }
    }
  }, [profileQuery.isError, profileQuery.error, queryClient]);

  // Reset the logout flag when the query succeeds
  useEffect(() => {
    if (profileQuery.isSuccess) {
      logoutTriggered.current = false;
    }
  }, [profileQuery.isSuccess]);

  const loginMutation = useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      api.login(username, password),
    retry: 0,
  });

  const login = useCallback(async (username: string, password: string) => {
    const response = await loginMutation.mutateAsync({ username, password });
    logoutTriggered.current = false;
    queryClient.setQueryData(adminQueryKeys.authProfile(), response.user);
  }, [loginMutation, queryClient]);

  const logout = useCallback(() => {
    api.logout();
    queryClient.clear();
  }, [queryClient]);

  const hasRole = useCallback((...roles: Role[]) => {
    if (!user) return false;
    return roles.includes(user.role);
  }, [user]);

  const value = useMemo(() => ({
    user,
    isLoading,
    isAuthenticated,
    login,
    logout,
    hasRole,
  }), [user, isLoading, isAuthenticated, login, logout, hasRole]);

  return (
    <AuthContext.Provider value={value}>
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
