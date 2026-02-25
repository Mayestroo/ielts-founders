import {
  BulkFullMockResult,
  Center,
  CreateAssignmentForm,
  CreateBulkFullMockForm,
  CreateCenterForm,
  CreateExamSectionForm,
  CreateFullMockForm,
  CreateUserForm,
  ExamAssignment,
  ExamResult,
  ExamSection,
  ExamSectionOption,
  GroupedAssignmentsResponse,
  LoginResponse,
  Role,
  StudentSummary,
  User
} from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

const TOKEN_KEY = 'admin_token';

class ApiClient {
  private buildReadOptions(options: ApiReadOptions = {}): RequestInit {
    return {
      signal: options.signal,
    };
  }

  setToken(token: string | null) {
    if (typeof window === 'undefined') return;
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  }

  private async request<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<T> {
    const token = this.getToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    };

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  // Auth
  async login(username: string, password: string): Promise<LoginResponse> {
    const response = await this.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.setToken(response.access_token);
    return response;
  }

  async getProfile(options: ApiReadOptions = {}): Promise<User> {
    return this.request<User>('/auth/profile', this.buildReadOptions(options));
  }

  logout() {
    this.setToken(null);

    if (typeof window !== 'undefined') {
      void Promise.resolve(
        fetch(`${API_URL}/auth/logout`, {
          method: 'POST',
          credentials: 'include',
        }),
      ).catch(() => undefined);
    }
  }

  // Users
  async getUsers(
    skip?: number,
    take?: number,
    search?: string,
    role?: Role,
    centerId?: string,
    options: ApiReadOptions = {},
  ): Promise<{ users: User[]; total: number }> {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append('skip', skip.toString());
    if (take !== undefined) params.append('take', take.toString());
    if (search) params.append('search', search);
    if (role) params.append('role', role);
    if (centerId) params.append('centerId', centerId);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ users: User[]; total: number }>(
      `/users${query}`,
      this.buildReadOptions(options),
    );
  }

  async getStudents(
    skip?: number,
    take?: number,
    search?: string,
    options: ApiReadOptions = {},
  ): Promise<{ users: StudentSummary[]; total: number }> {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append('skip', skip.toString());
    if (take !== undefined) params.append('take', take.toString());
    if (search?.trim()) params.append('search', search.trim());
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ users: StudentSummary[]; total: number }>(
      `/users/students${query}`,
      this.buildReadOptions(options),
    );
  }

  async createUser(data: CreateUserForm): Promise<User> {
    return this.request<User>('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateUser(id: string, data: Partial<CreateUserForm>): Promise<User> {
    return this.request<User>(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteUser(id: string): Promise<void> {
    return this.request(`/users/${id}`, { method: 'DELETE' });
  }

  // Centers
  async getCenters(options: ApiReadOptions = {}): Promise<Center[]> {
    return this.request<Center[]>('/centers', this.buildReadOptions(options));
  }

  async getCenter(id: string, options: ApiReadOptions = {}): Promise<Center> {
    return this.request<Center>(`/centers/${id}`, this.buildReadOptions(options));
  }

  async createCenter(data: CreateCenterForm): Promise<Center> {
    return this.request<Center>('/centers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateCenter(id: string, data: CreateCenterForm): Promise<Center> {
    return this.request<Center>(`/centers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteCenter(id: string): Promise<void> {
    return this.request(`/centers/${id}`, { method: 'DELETE' });
  }

  // Exam Sections
  async getExamSections(options: ApiReadOptions = {}): Promise<ExamSection[]> {
    return this.request<ExamSection[]>('/exam-sections', this.buildReadOptions(options));
  }

  async getExamSection(id: string, options: ApiReadOptions = {}): Promise<ExamSection> {
    return this.request<ExamSection>(`/exam-sections/${id}`, this.buildReadOptions(options));
  }

  async getExamSectionOptions(options: ApiReadOptions = {}): Promise<ExamSectionOption[]> {
    return this.request<ExamSectionOption[]>(
      '/exam-sections/options',
      this.buildReadOptions(options),
    );
  }

  async createExamSection(data: CreateExamSectionForm): Promise<ExamSection> {
    return this.request<ExamSection>('/exam-sections', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateExamSection(id: string, data: Partial<CreateExamSectionForm>): Promise<ExamSection> {
    return this.request<ExamSection>(`/exam-sections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteExamSection(id: string): Promise<void> {
    return this.request(`/exam-sections/${id}`, { method: 'DELETE' });
  }

  // Assignments
  async getGroupedAssignments(
    skip?: number,
    take?: number,
    search?: string,
    sectionType?: string,
    fullMockOnly?: boolean,
    options: ApiReadOptions = {},
  ): Promise<GroupedAssignmentsResponse> {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append('skip', skip.toString());
    if (take !== undefined) params.append('take', take.toString());
    if (search?.trim()) params.append('search', search.trim());
    if (sectionType) params.append('sectionType', sectionType);
    if (fullMockOnly) params.append('fullMockOnly', 'true');
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<GroupedAssignmentsResponse>(
      `/assignments/grouped${query}`,
      this.buildReadOptions(options),
    );
  }

  async getStudentAssignments(
    studentId: string,
    fullMockOnly?: boolean,
    options: ApiReadOptions = {},
  ): Promise<ExamAssignment[]> {
    const query = fullMockOnly ? '?fullMockOnly=true' : '';
    return this.request<ExamAssignment[]>(
      `/assignments/student/${studentId}${query}`,
      this.buildReadOptions(options),
    );
  }

  async createAssignment(data: CreateAssignmentForm): Promise<ExamAssignment> {
    return this.request<ExamAssignment>('/assignments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createFullMockAssignment(
    data: CreateFullMockForm,
  ): Promise<{ session: unknown; assignments: ExamAssignment[] }> {
    return this.request('/assignments/full-mock', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createBulkFullMockAssignment(
    data: CreateBulkFullMockForm,
  ): Promise<BulkFullMockResult> {
    return this.request<BulkFullMockResult>('/assignments/full-mock/bulk', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateFullMockResultVisibility(
    sessionId: string,
    showResultsToStudent: boolean,
  ): Promise<{ id: string; resultsVisibleToStudent: boolean }> {
    return this.request<{ id: string; resultsVisibleToStudent: boolean }>(
      `/full-mock-sessions/${sessionId}/result-visibility`,
      {
        method: 'PUT',
        body: JSON.stringify({ showResultsToStudent }),
      },
    );
  }

  // Results
  async getResults(
    skip?: number,
    take?: number,
    options: ApiReadOptions = {},
  ): Promise<{ results: ExamResult[]; total: number }> {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append('skip', skip.toString());
    if (take !== undefined) params.append('take', take.toString());
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ results: ExamResult[]; total: number }>(
      `/results${query}`,
      this.buildReadOptions(options),
    );
  }

  async getResult(id: string, options: ApiReadOptions = {}): Promise<ExamResult> {
    return this.request<ExamResult>(`/results/${id}`, this.buildReadOptions(options));
  }

  async evaluateWriting(
    resultId: string,
  ): Promise<ExamResult & { aiEvaluation?: unknown }> {
    return this.request<ExamResult & { aiEvaluation?: unknown }>(
      `/results/${resultId}/evaluate-writing`,
      {
        method: 'POST',
      },
    );
  }

  async reassignAssignment(assignmentId: string): Promise<unknown> {
    return this.request(`/assignments/${assignmentId}/reassign`, {
      method: 'POST',
    });
  }

  async deleteAssignment(assignmentId: string): Promise<unknown> {
    return this.request(`/assignments/${assignmentId}`, {
      method: 'DELETE',
    });
  }

  async getDashboardStats(options: ApiReadOptions = {}) {
    return this.request<{
      counts: {
        totalUsers: number;
        examSections: number;
        activeAssignments: number;
        completedTests: number;
      };
      growth: {
        users: number;
        sections: number;
        assignments: number;
        completedTests: number;
      };
      activity: {
        type: 'success' | 'info' | 'warning' | 'default';
        action: string;
        user: string;
        time: string;
      }[];
    }>('/dashboard/stats', this.buildReadOptions(options));
  }

  // Uploads
  async uploadFile(
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<{ url: string }> {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();
      const token = this.getToken();

      xhr.open('POST', `${API_URL}/uploads`, true);
      xhr.withCredentials = true;
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const percentComplete = Math.round((event.loaded / event.total) * 100);
          onProgress(percentComplete);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch {
            reject(new Error('Failed to parse upload response'));
          }
        } else {
          try {
            const error = JSON.parse(xhr.responseText);
            reject(new Error(error.message || `Upload failed with status ${xhr.status}`));
          } catch {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => {
        reject(new Error('Network error during upload'));
      };

      xhr.send(formData);
    });
  }
}

interface ApiReadOptions {
  signal?: AbortSignal;
}

export const api = new ApiClient();
