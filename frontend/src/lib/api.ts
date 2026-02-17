import {
    Center,
    ExamAssignment,
    ExamResult,
    HeartbeatResponse,
    LoginResponse,
    RegisterPayload,
    RegisterWithGooglePayload,
    ReconnectResponse,
    StartExamResponse,
    SubmitExamResponse,
    SyncResponse,
    User
} from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api";
const ACCESS_TOKEN_STORAGE_KEY = "student_access_token";
const REFRESH_TOKEN_STORAGE_KEY = "student_refresh_token";

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  allowRefresh?: boolean;
}

export type ApiReadOptions = Pick<RequestOptions, "signal">;

class ApiClient {
  private token: string | null = null;
  private refreshToken: string | null = null;
  private refreshInFlight: Promise<string | null> | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      this.token = window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
      this.refreshToken = window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
    }
  }

  setToken(token: string | null) {
    this.token = token;

    if (typeof window !== "undefined") {
      if (token) {
        window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
      } else {
        window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
      }
    }
  }

  getToken(): string | null {
    return this.token;
  }

  setRefreshToken(token: string | null) {
    this.refreshToken = token;

    if (typeof window !== "undefined") {
      if (token) {
        window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, token);
      } else {
        window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
      }
    }
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const {
      timeoutMs = 15000,
      retries = 3,
      backoffMs = 500,
      allowRefresh = true,
      ...fetchOptions
    } = options;

    let attemptsLeft = retries;
    let currentBackoffMs = backoffMs;
    let refreshTried = false;

    while (true) {
      const token = this.getToken();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      if (fetchOptions.signal) {
        if (fetchOptions.signal.aborted) {
          controller.abort();
        } else {
          fetchOptions.signal.addEventListener('abort', () => controller.abort(), {
            once: true,
          });
        }
      }

      try {
        const headers: HeadersInit = {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
          ...fetchOptions.headers,
        };

        const response = await fetch(`${API_URL}${endpoint}`, {
          ...fetchOptions,
          headers,
          credentials: fetchOptions.credentials ?? "omit",
          signal: controller.signal,
        });

        if (!response.ok) {
          if (
            response.status === 401 &&
            allowRefresh &&
            !refreshTried &&
            endpoint !== "/auth/login" &&
            endpoint !== "/auth/google/login" &&
            endpoint !== "/auth/google/register" &&
            endpoint !== "/auth/refresh"
          ) {
            const hasRefreshToken = Boolean(this.getRefreshToken());

            if (hasRefreshToken) {
              const refreshedToken = await this.refreshAccessToken();
              refreshTried = true;

              if (refreshedToken) {
                clearTimeout(timeoutId);
                continue;
              }

              this.logout();
              throw new Error("Session expired");
            }

            if (this.getToken()) {
              this.logout();
              throw new Error("Session expired");
            }
          }

          if (
            attemptsLeft > 0 &&
            this.isRetryableResponse(endpoint, fetchOptions.method, response.status)
          ) {
            await this.sleep(currentBackoffMs);
            attemptsLeft -= 1;
            currentBackoffMs = Math.min(currentBackoffMs * 2, 8000);
            clearTimeout(timeoutId);
            continue;
          }

          const message = await this.extractErrorMessage(response);
          throw new Error(message || `HTTP error! status: ${response.status}`);
        }

        if (response.status === 204) {
          return undefined as T;
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          const text = await response.text();
          return text as T;
        }

        return response.json();
      } catch (error) {
        const isTimeoutError =
          error instanceof DOMException && error.name === "AbortError";
        const isNetworkError =
          error instanceof TypeError ||
          (error instanceof Error && error.message === "Failed to fetch");

        if (
          attemptsLeft > 0 &&
          this.isRetryableNetworkFailure(endpoint, fetchOptions.method) &&
          (isTimeoutError || isNetworkError)
        ) {
          await this.sleep(currentBackoffMs);
          attemptsLeft -= 1;
          currentBackoffMs = Math.min(currentBackoffMs * 2, 8000);
          clearTimeout(timeoutId);
          continue;
        }

        if (isTimeoutError) {
          throw new Error(`Request timeout after ${timeoutMs}ms`);
        }

        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  private async refreshAccessToken(): Promise<string | null> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      return null;
    }

    this.refreshInFlight = (async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
          credentials: "omit",
          signal: controller.signal,
        });

        if (!response.ok) {
          return null;
        }

        const payload = (await response.json()) as {
          access_token?: string;
          refresh_token?: string;
        };
        if (!payload.access_token) {
          return null;
        }

        this.setToken(payload.access_token);
        if (payload.refresh_token) {
          this.setRefreshToken(payload.refresh_token);
        }
        return payload.access_token;
      } catch {
        return null;
      } finally {
        clearTimeout(timeoutId);
      }
    })();

    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private isRetryableResponse(
    endpoint: string,
    method: string | undefined,
    status: number,
  ) {
    const retryableStatuses = [408, 425, 429, 500, 502, 503, 504];
    if (!retryableStatuses.includes(status)) {
      return false;
    }

    return this.isRetryableNetworkFailure(endpoint, method);
  }

  private isRetryableNetworkFailure(endpoint: string, method: string | undefined) {
    const normalizedMethod = (method || "GET").toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(normalizedMethod)) {
      return true;
    }

    if (normalizedMethod !== "POST") {
      return false;
    }

    return [
      /^\/assignments\/[^/]+\/(start|submit|sync|heartbeat|reconnect)$/,
      /^\/auth\/refresh$/,
    ].some((pattern) => pattern.test(endpoint));
  }

  private async extractErrorMessage(response: Response): Promise<string> {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const parsed = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      if (parsed?.message) {
        return parsed.message;
      }
    } else {
      const text = await response.text().catch(() => "");
      if (text) {
        return text;
      }
    }

    return "Request failed";
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Auth
  async register(payload: RegisterPayload): Promise<LoginResponse> {
    const response = await this.request<LoginResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: payload.username,
        password: payload.password,
        firstName: payload.firstName,
        lastName: payload.lastName,
        attendanceMode: payload.attendanceMode,
        scheduledAt: payload.scheduledAt,
        referralSource: payload.referralSource,
        phoneNumber: payload.phoneNumber,
      }),
      allowRefresh: false,
    });

    this.setToken(response.access_token);
    this.setRefreshToken(response.refresh_token);
    return response;
  }

  async login(username: string, password: string): Promise<LoginResponse> {
    const response = await this.request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
      allowRefresh: false,
    });
    this.setToken(response.access_token);
    this.setRefreshToken(response.refresh_token);
    return response;
  }

  async registerWithGoogle(
    idToken: string,
    registration: RegisterWithGooglePayload,
  ): Promise<LoginResponse> {
    const response = await this.request<LoginResponse>("/auth/google/register", {
      method: "POST",
      body: JSON.stringify({
        idToken,
        firstName: registration.firstName,
        lastName: registration.lastName,
        attendanceMode: registration.attendanceMode,
        scheduledAt: registration.scheduledAt,
        referralSource: registration.referralSource,
        phoneNumber: registration.phoneNumber,
      }),
      allowRefresh: false,
    });
    this.setToken(response.access_token);
    this.setRefreshToken(response.refresh_token);
    return response;
  }

  async loginWithGoogle(idToken: string): Promise<LoginResponse> {
    const response = await this.request<LoginResponse>("/auth/google/login", {
      method: "POST",
      body: JSON.stringify({ idToken }),
      allowRefresh: false,
    });
    this.setToken(response.access_token);
    this.setRefreshToken(response.refresh_token);
    return response;
  }

  async getProfile(options: ApiReadOptions = {}): Promise<User> {
    return this.request<User>("/auth/profile", options);
  }

  logout() {
    const refreshToken = this.getRefreshToken();
    this.setToken(null);
    this.setRefreshToken(null);

    if (refreshToken) {
      void Promise.resolve(
        fetch(`${API_URL}/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
          credentials: "omit",
        }),
      ).catch(() => undefined);
    }
  }

  // Assignments
  async getCenter(id: string, options: ApiReadOptions = {}): Promise<Center> {
    return this.request<Center>(`/centers/${id}`, options);
  }

  async getMyAssignments(options: ApiReadOptions = {}): Promise<ExamAssignment[]> {
    return this.request<ExamAssignment[]>("/assignments/my", options);
  }

  async getAssignment(id: string, options: ApiReadOptions = {}): Promise<ExamAssignment> {
    return this.request<ExamAssignment>(`/assignments/${id}`, options);
  }

  async getMyResults(options: ApiReadOptions = {}): Promise<ExamResult[]> {
    return this.request<ExamResult[]>("/results/my", options);
  }

  async getResult(id: string, options: ApiReadOptions = {}): Promise<ExamResult> {
    return this.request<ExamResult>(`/results/${id}`, options);
  }

  async startExam(
    assignmentId: string
  ): Promise<StartExamResponse> {
    return this.request<StartExamResponse>(`/assignments/${assignmentId}/start`, {
      method: "POST",
      timeoutMs: 12000,
      retries: 2,
    });
  }

  async submitExam(
    assignmentId: string,
    answers: Record<string, string | string[] | Record<string, string>>,
    tabId: string,
  ): Promise<SubmitExamResponse> {
    return this.request<SubmitExamResponse>(`/assignments/${assignmentId}/submit`, {
      method: "POST",
      body: JSON.stringify({ answers, tabId }),
      timeoutMs: 20000,
      retries: 2,
    });
  }

  // Session Management
  async heartbeat(
    assignmentId: string,
    tabId?: string
  ): Promise<HeartbeatResponse> {
    return this.request<HeartbeatResponse>(`/assignments/${assignmentId}/heartbeat`, {
      method: "POST",
      body: JSON.stringify({ tabId }),
      timeoutMs: 8000,
      retries: 1,
    });
  }

  async syncAnswers(
    assignmentId: string,
    answers: Record<string, unknown>,
    highlights: unknown[] = [],
    tabId: string,
    syncVersion = 0
  ): Promise<SyncResponse> {
    return this.request<SyncResponse>(`/assignments/${assignmentId}/sync`, {
      method: "POST",
      body: JSON.stringify({ answers, highlights, syncVersion, tabId }),
      timeoutMs: 10000,
      retries: 2,
    });
  }

  async reconnectExam(
    assignmentId: string,
    clientAnswers?: Record<string, unknown>,
    tabId?: string
  ): Promise<ReconnectResponse> {
    return this.request<ReconnectResponse>(`/assignments/${assignmentId}/reconnect`, {
      method: "POST",
      body: JSON.stringify({ clientAnswers, tabId }),
      timeoutMs: 12000,
      retries: 2,
    });
  }
}

export const api = new ApiClient();
