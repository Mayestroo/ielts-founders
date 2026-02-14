import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { HttpClient } from '../interfaces/http-client.interface';

@Injectable()
export class AxiosHttpClient implements HttpClient {
  private readonly logger = new Logger(AxiosHttpClient.name);
  private readonly defaultTimeoutMs = Number(
    process.env.HTTP_CLIENT_TIMEOUT_MS ?? 15000,
  );

  constructor(private readonly httpService: HttpService) {}

  async post<T>(
    url: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    try {
      const response = await this.httpService.axiosRef.post<T>(url, body, {
        headers,
        timeout: this.defaultTimeoutMs,
      });
      return response.data;
    } catch (error) {
      this.handleHttpError('POST', url, error);
    }
  }

  async get<T>(url: string, headers?: Record<string, string>): Promise<T> {
    try {
      const response = await this.httpService.axiosRef.get<T>(url, {
        headers,
        timeout: this.defaultTimeoutMs,
      });
      return response.data;
    } catch (error) {
      this.handleHttpError('GET', url, error);
    }
  }

  private handleHttpError(method: string, url: string, error: unknown): never {
    const axiosError = error as {
      code?: string;
      message?: string;
      response?: { status?: number };
    };

    const isTimeout =
      axiosError.code === 'ECONNABORTED' ||
      axiosError.message?.toLowerCase().includes('timeout');
    const status = axiosError.response?.status;

    if (isTimeout) {
      this.logger.warn(
        `${method} ${url} timed out after ${this.defaultTimeoutMs}ms`,
      );
      throw new Error(
        `HTTP ${method} timeout after ${this.defaultTimeoutMs}ms`,
      );
    }

    if (status) {
      this.logger.warn(`${method} ${url} failed with status ${status}`);
    }

    throw error;
  }
}
