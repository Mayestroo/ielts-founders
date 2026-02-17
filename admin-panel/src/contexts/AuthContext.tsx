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
  useContext,
  useEffect,
  useState,
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

const isAuthError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('401') ||
    message.includes('403') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('session expired')
  );
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [sessionUser, setSessionUser] = useState<User | null>(null);

  const profileQuery = useQuery({
    queryKey: adminQueryKeys.authProfile(),
    queryFn: ({ signal }) => api.getProfile({ signal }),
    staleTime: ADMIN_QUERY_TIMINGS.profile.staleTime,
    gcTime: ADMIN_QUERY_TIMINGS.profile.gcTime,
  });

  useEffect(() => {
    if (profileQuery.data) {
      setSessionUser(profileQuery.data);
    }
  }, [profileQuery.data]);

  useEffect(() => {
    if (!profileQuery.error) {
      return;
    }

    if (isAuthError(profileQuery.error)) {
      api.logout();
      setSessionUser(null);
      queryClient.removeQueries({ queryKey: adminQueryKeys.authProfile() });
      return;
    }

    console.warn(
      'Profile fetch failed but keeping session (transient error):',
      profileQuery.error,
    );
  }, [profileQuery.error, queryClient]);

  const loginMutation = useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      api.login(username, password),
    retry: 0,
  });

  const login = async (username: string, password: string) => {
    const response = await loginMutation.mutateAsync({ username, password });
    setSessionUser(response.user);
    queryClient.setQueryData(adminQueryKeys.authProfile(), response.user);
  };

  const logout = () => {
    api.logout();
    setSessionUser(null);
    queryClient.clear();
  };

  const hasRole = (...roles: Role[]) => {
    if (!sessionUser) return false;
    return roles.includes(sessionUser.role);
  };

  const isLoading = profileQuery.isPending && !sessionUser;

  return (
    <AuthContext.Provider
      value={{
        user: sessionUser,
        isLoading,
        isAuthenticated: !!sessionUser,
        login,
        logout,
        hasRole,
      }}
    >
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
