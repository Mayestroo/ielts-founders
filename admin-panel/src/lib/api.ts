import {
    Center,
    CreateAssignmentForm,
    CreateCenterForm,
    CreateExamSectionForm,
    CreateUserForm,
    ExamAssignment,
    ExamResult,
    ExamSection,
    LoginResponse,
    User
} from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('token', token);
      } else {
        localStorage.removeItem('token');
      }
    }
  }

  getToken(): string | null {
    if (this.token) return this.token;
    if (typeof window !== 'undefined') {
      return localStorage.getItem('token');
    }
    return null;
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
  }

  // Users
  async getUsers(skip?: number, take?: number): Promise<{ users: User[]; total: number }> {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append('skip', skip.toString());
    if (take !== undefined) params.append('take', take.toString());
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ users: User[]; total: number }>(`/users${query}`);
  }

  async getUser(id: string): Promise<User> {
    return this.request<User>(`/users/${id}`);
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
  async getAssignments(skip?: number, take?: number): Promise<{ assignments: ExamAssignment[]; total: number }> {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append('skip', skip.toString());
    if (take !== undefined) params.append('take', take.toString());
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ assignments: ExamAssignment[]; total: number }>(`/assignments${query}`);
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

  // Results
  async getResults(skip?: number, take?: number): Promise<{ results: ExamResult[]; total: number }> {
    const params = new URLSearchParams();
    if (skip !== undefined) params.append('skip', skip.toString());
    if (take !== undefined) params.append('take', take.toString());
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ results: ExamResult[]; total: number }>(`/results${query}`);
  }

  async getStudentResults(studentId: string): Promise<ExamResult[]> {
    return this.request<ExamResult[]>(`/results/student/${studentId}`);
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

  async getStudentReportData(studentId: string): Promise<ExamResult[]> {
    return this.request<ExamResult[]>(`/results/student/${studentId}`);
  }

  async getDashboardStats() {
    return this.request<{
      counts: {
        totalUsers: number;
        examSections: number;
        activeAssignments: number;
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
