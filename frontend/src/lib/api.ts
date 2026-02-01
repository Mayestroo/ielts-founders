import {
  Center,
  CreateAssignmentForm,
  CreateCenterForm,
  CreateExamSectionForm,
  CreateUserForm,
  ExamAssignment,
  ExamResult,
  ExamSection,
  HeartbeatResponse,
  LoginResponse,
  ReconnectResponse,
  StartExamResponse,
  SubmitExamResponse,
  SyncResponse,
  User
} from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api";

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (typeof window !== "undefined") {
      if (token) {
        localStorage.setItem("token", token);
      } else {
        localStorage.removeItem("token");
      }
    }
  }

  getToken(): string | null {
    if (this.token) return this.token;
    if (typeof window !== "undefined") {
      return localStorage.getItem("token");
    }
    return null;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retries = 3,
    backoff = 500
  ): Promise<T> {
    const token = this.getToken();
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    };

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
      });

      if (!response.ok) {
        // Retry for server-side gateway/proxy errors (502, 503, 504)
        if (retries > 0 && [502, 503, 504].includes(response.status)) {
          console.warn(`Server error ${response.status}, retrying in ${backoff}ms... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, backoff));
          return this.request(endpoint, options, retries - 1, backoff * 2);
        }

        const error = await response
          .json()
          .catch(() => ({ message: "Request failed" }));
        throw new Error(
          error.message || `HTTP error! status: ${response.status}`
        );
      }

      return response.json();
    } catch (error) {
      if (retries > 0 && error instanceof TypeError && error.message === 'Failed to fetch') {
        console.warn(`Network error, retrying in ${backoff}ms... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        return this.request(endpoint, options, retries - 1, backoff * 2);
      }
      throw error;
    }
  }

  // Auth
  async login(username: string, password: string): Promise<LoginResponse> {
    const response = await this.request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    this.setToken(response.access_token);
    return response;
  }

  async getProfile(): Promise<User> {
    return this.request<User>("/auth/profile");
  }

  logout() {
    this.setToken(null);
  }

  // Users
  async getUsers(): Promise<User[]> {
    return this.request<User[]>("/users");
  }

  async getUser(id: string): Promise<User> {
    return this.request<User>(`/users/${id}`);
  }

  async createUser(data: CreateUserForm): Promise<User> {
    return this.request<User>("/users", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateUser(id: string, data: Partial<CreateUserForm>): Promise<User> {
    return this.request<User>(`/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteUser(id: string): Promise<void> {
    return this.request(`/users/${id}`, { method: "DELETE" });
  }

  // Centers
  async getCenters(): Promise<Center[]> {
    return this.request<Center[]>("/centers");
  }

  async getCenter(id: string): Promise<Center> {
    return this.request<Center>(`/centers/${id}`);
  }

  async createCenter(data: CreateCenterForm): Promise<Center> {
    return this.request<Center>("/centers", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateCenter(id: string, data: CreateCenterForm): Promise<Center> {
    return this.request<Center>(`/centers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteCenter(id: string): Promise<void> {
    return this.request(`/centers/${id}`, { method: "DELETE" });
  }

  // Exam Sections
  async getExamSections(): Promise<ExamSection[]> {
    return this.request<ExamSection[]>("/exam-sections");
  }

  async getExamSection(id: string): Promise<ExamSection> {
    return this.request<ExamSection>(`/exam-sections/${id}`);
  }

  async createExamSection(data: CreateExamSectionForm): Promise<ExamSection> {
    return this.request<ExamSection>("/exam-sections", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async deleteExamSection(id: string): Promise<void> {
    return this.request(`/exam-sections/${id}`, { method: "DELETE" });
  }

  // Assignments
  async getStudentAssignments(studentId: string): Promise<ExamAssignment[]> {
    return this.request<ExamAssignment[]>(`/assignments/student/${studentId}`);
  }

  async getMyAssignments(): Promise<ExamAssignment[]> {
    return this.request<ExamAssignment[]>("/assignments/my");
  }

  async getAssignment(id: string): Promise<ExamAssignment> {
    return this.request<ExamAssignment>(`/assignments/${id}`);
  }

  async startExam(
    assignmentId: string
  ): Promise<StartExamResponse> {
    return this.request<StartExamResponse>(`/assignments/${assignmentId}/start`, {
      method: "POST",
    });
  }

  async submitExam(
    assignmentId: string,
    answers: Record<string, string | string[] | Record<string, string>>
  ): Promise<SubmitExamResponse> {
    return this.request<SubmitExamResponse>(`/assignments/${assignmentId}/submit`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    });
  }

  async saveHighlights(
    assignmentId: string,
    highlights: Record<string, { text: string; color: string }[]>
  ): Promise<void> {
    return this.request(`/assignments/${assignmentId}/highlight`, {
      method: "POST",
      body: JSON.stringify({ highlights }),
    });
  }

  async createAssignment(data: CreateAssignmentForm): Promise<ExamAssignment> {
    return this.request<ExamAssignment>("/assignments", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Results
  async getStudentResults(studentId: string): Promise<ExamResult[]> {
    return this.request<ExamResult[]>(`/results/student/${studentId}`);
  }

  // Session Management
  async heartbeat(
    assignmentId: string,
    tabId?: string
  ): Promise<HeartbeatResponse> {
    return this.request<HeartbeatResponse>(`/assignments/${assignmentId}/heartbeat`, {
      method: "POST",
      body: JSON.stringify({ tabId }),
    });
  }

  async syncAnswers(
    assignmentId: string,
    answers: Record<string, any>,
    highlights: any[] = [],
    syncVersion = 0
  ): Promise<SyncResponse> {
    return this.request<SyncResponse>(`/assignments/${assignmentId}/sync`, {
      method: "POST",
      body: JSON.stringify({ answers, highlights, syncVersion }),
    });
  }

  async reconnectExam(
    assignmentId: string,
    clientAnswers?: Record<string, any>,
    tabId?: string
  ): Promise<ReconnectResponse> {
    return this.request<ReconnectResponse>(`/assignments/${assignmentId}/reconnect`, {
      method: "POST",
      body: JSON.stringify({ clientAnswers, tabId }),
    });
  }
}

export const api = new ApiClient();
