import { DefaultOptions } from "@tanstack/react-query";

const NON_RETRYABLE_MESSAGES = [
  "unauthorized",
  "forbidden",
  "session expired",
  "already submitted",
  "not found",
  "invalid token",
  "bad request",
];

const TRANSIENT_MESSAGES = [
  "http error! status: 429",
  "http error! status: 502",
  "http error! status: 503",
  "http error! status: 504",
  "request timeout",
  "failed to fetch",
  "network",
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

export const STUDENT_QUERY_TIMINGS = {
  profile: {
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  },
  center: {
    staleTime: 30 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  },
  assignments: {
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  },
  assignmentDetail: {
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  },
  results: {
    staleTime: 90 * 1000,
    gcTime: 15 * 60 * 1000,
  },
  feedback: {
    staleTime: 90 * 1000,
    gcTime: 15 * 60 * 1000,
  },
} as const;

export const studentQueryDefaults: DefaultOptions = {
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
