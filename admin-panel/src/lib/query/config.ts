import { DefaultOptions } from "@tanstack/react-query";

const NON_RETRYABLE_MESSAGES = [
  "unauthorized",
  "forbidden",
  "not found",
  "bad request",
  "invalid",
  "already exists",
];

const TRANSIENT_MESSAGES = [
  "http error! status: 429",
  "http error! status: 502",
  "http error! status: 503",
  "http error! status: 504",
  "network",
  "timeout",
  "failed to fetch",
  "temporary",
];

const shouldRetryQuery = (failureCount: number, error: unknown) => {
  if (failureCount >= 2) {
    return false;
  }

  if (!(error instanceof Error)) {
    return true;
  }

  const message = error.message.toLowerCase();
  if (NON_RETRYABLE_MESSAGES.some((keyword) => message.includes(keyword))) {
    return false;
  }

  return TRANSIENT_MESSAGES.some((keyword) => message.includes(keyword));
};

export const ADMIN_QUERY_TIMINGS = {
  profile: {
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  },
  center: {
    staleTime: 30 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  },
  dashboardStats: {
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  },
  list: {
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  },
  reference: {
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  },
} as const;

export const adminQueryDefaults: DefaultOptions = {
  queries: {
    staleTime: 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: shouldRetryQuery,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 6000),
  },
  mutations: {
    retry: 0,
  },
};
