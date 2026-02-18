'use client';

import { api } from '@/lib/api';
import { STUDENT_QUERY_TIMINGS } from '@/lib/query/config';
import { studentQueryKeys } from '@/lib/query/keys';
import { RegisterPayload, RegisterWithGooglePayload, User } from '@/types';
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
  const hasSessionToken = Boolean(api.getToken() || api.getRefreshToken());

  const profileQuery = useQuery({
    queryKey: studentQueryKeys.authProfile(),
    queryFn: ({ signal }) => api.getProfile({ signal }),
    enabled: hasSessionToken,
    staleTime: STUDENT_QUERY_TIMINGS.profile.staleTime,
    gcTime: STUDENT_QUERY_TIMINGS.profile.gcTime,
  });

  useEffect(() => {
    if (!profileQuery.data) {
      return;
    }

    if (profileQuery.data.role !== 'STUDENT') {
      api.logout();
      setSessionUser(null);
      queryClient.removeQueries({ queryKey: studentQueryKeys.authProfile() });
      return;
    }

    setSessionUser(profileQuery.data);
  }, [profileQuery.data, queryClient]);

  useEffect(() => {
    if (!profileQuery.error) {
      return;
    }

    if (isAuthError(profileQuery.error)) {
      api.logout();
      setSessionUser(null);
      queryClient.removeQueries({ queryKey: studentQueryKeys.authProfile() });
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

  const registerMutation = useMutation({
    mutationFn: (payload: RegisterPayload) => api.register(payload),
    retry: 0,
  });

  const registerWithGoogleMutation = useMutation({
    mutationFn: ({
      idToken,
      registration,
    }: {
      idToken: string;
      registration: RegisterWithGooglePayload;
    }) => api.registerWithGoogle(idToken, registration),
    retry: 0,
  });

  const loginWithGoogleMutation = useMutation({
    mutationFn: ({ idToken }: { idToken: string }) => api.loginWithGoogle(idToken),
    retry: 0,
  });

  const commitAuthenticatedUser = (nextUser: User) => {
    setSessionUser(nextUser);
    queryClient.setQueryData(studentQueryKeys.authProfile(), nextUser);
  };

  const login = async (username: string, password: string) => {
    const response = await loginMutation.mutateAsync({ username, password });

    if (response.user.role !== 'STUDENT') {
      api.logout();
      throw new Error('This portal is for student accounts only');
    }

    commitAuthenticatedUser(response.user);
  };

  const register = async (payload: RegisterPayload) => {
    const response = await registerMutation.mutateAsync(payload);

    if (response.user.role !== 'STUDENT') {
      api.logout();
      throw new Error('This portal is for student accounts only');
    }

    commitAuthenticatedUser(response.user);
  };

  const registerWithGoogle = async (
    idToken: string,
    registration: RegisterWithGooglePayload,
  ) => {
    const response = await registerWithGoogleMutation.mutateAsync({
      idToken,
      registration,
    });

    if (response.user.role !== 'STUDENT') {
      api.logout();
      throw new Error('This portal is for student accounts only');
    }

    commitAuthenticatedUser(response.user);
  };

  const loginWithGoogle = async (idToken: string) => {
    const response = await loginWithGoogleMutation.mutateAsync({ idToken });

    if (response.user.role !== 'STUDENT') {
      api.logout();
      throw new Error('This portal is for student accounts only');
    }

    commitAuthenticatedUser(response.user);
  };

  const logout = () => {
    api.logout();
    setSessionUser(null);
    queryClient.clear();
  };

  const isLoading = hasSessionToken && profileQuery.isPending && !sessionUser;

  return (
    <AuthContext.Provider
      value={{
        user: sessionUser,
        isLoading,
        isAuthenticated: !!sessionUser,
        register,
        login,
        registerWithGoogle,
        loginWithGoogle,
        logout,
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
