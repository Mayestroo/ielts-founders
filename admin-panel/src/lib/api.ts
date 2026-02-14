import {
    Center,
    CreateAssignmentForm,
    CreateFullMockForm,
    CreateCenterForm,
    CreateExamSectionForm,
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

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
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

  async getProfile(): Promise<User> {
    return this.request<User>('/auth/profile');
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
  async getUsers(skip?: number, take?: number, search?: string, role?: Role, centerId?: string): Promise<{ users: User[]; total: number }> {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append('skip', skip.toString());
    if (take !== undefined) params.append('take', take.toString());
    if (search) params.append('search', search);
    if (role) params.append('role', role);
    if (centerId) params.append('centerId', centerId);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ users: User[]; total: number }>(`/users${query}`);
  }

  async getStudents(
    skip?: number,
    take?: number,
    search?: string,
  ): Promise<{ users: StudentSummary[]; total: number }> {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append('skip', skip.toString());
    if (take !== undefined) params.append('take', take.toString());
    if (search?.trim()) params.append('search', search.trim());
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ users: StudentSummary[]; total: number }>(`/users/students${query}`);
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
  async getCenters(): Promise<Center[]> {
    return this.request<Center[]>('/centers');
  }

  async getCenter(id: string): Promise<Center> {
    return this.request<Center>(`/centers/${id}`);
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
  async getExamSections(): Promise<ExamSection[]> {
    return this.request<ExamSection[]>('/exam-sections');
  }

  async getExamSection(id: string): Promise<ExamSection> {
    return this.request<ExamSection>(`/exam-sections/${id}`);
  }

  async getExamSectionOptions(): Promise<ExamSectionOption[]> {
    return this.request<ExamSectionOption[]>('/exam-sections/options');
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
  ): Promise<GroupedAssignmentsResponse> {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append('skip', skip.toString());
    if (take !== undefined) params.append('take', take.toString());
    if (search?.trim()) params.append('search', search.trim());
    if (sectionType) params.append('sectionType', sectionType);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<GroupedAssignmentsResponse>(`/assignments/grouped${query}`);
  }

  async getStudentAssignments(studentId: string): Promise<ExamAssignment[]> {
    return this.request<ExamAssignment[]>(`/assignments/student/${studentId}`);
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

  // Results
  async getResults(skip?: number, take?: number): Promise<{ results: ExamResult[]; total: number }> {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append('skip', skip.toString());
    if (take !== undefined) params.append('take', take.toString());
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ results: ExamResult[]; total: number }>(`/results${query}`);
  }

  async getResult(id: string): Promise<ExamResult> {
    return this.request<ExamResult>(`/results/${id}`);
  }

  async evaluateWriting(resultId: string): Promise<any> {
    return this.request(`/results/${resultId}/evaluate-writing`, {
      method: 'POST',
    });
  }

  async reassignAssignment(assignmentId: string): Promise<any> {
    return this.request(`/assignments/${assignmentId}/reassign`, {
      method: 'POST',
    });
  }

  async deleteAssignment(assignmentId: string): Promise<any> {
    return this.request(`/assignments/${assignmentId}`, {
      method: 'DELETE',
    });
  }

  async getDashboardStats() {
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
    }>('/dashboard/stats');
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
          } catch (e) {
            reject(new Error('Failed to parse upload response'));
          }
        } else {
          try {
            const error = JSON.parse(xhr.responseText);
            reject(new Error(error.message || `Upload failed with status ${xhr.status}`));
          } catch (e) {
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

export const api = new ApiClient();
