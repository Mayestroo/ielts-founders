import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import {
  HttpClient,
  RequestOptions,
} from '../interfaces/http-client.interface';

function normalizeOptions(
  headersOrOptions?: Record<string, string> | RequestOptions,
): RequestOptions {
  if (!headersOrOptions) {
    return {};
  }
  // If it has 'headers' or 'timeoutMs' keys, treat as RequestOptions
  if ('headers' in headersOrOptions || 'timeoutMs' in headersOrOptions) {
    return headersOrOptions as RequestOptions;
  }
  // Otherwise it's a plain headers map (legacy signature)
  return { headers: headersOrOptions as Record<string, string> };
}

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
    headersOrOptions?: Record<string, string> | RequestOptions,
  ): Promise<T> {
    const opts = normalizeOptions(headersOrOptions);
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    try {
      const response = await this.httpService.axiosRef.post<T>(url, body, {
        headers: opts.headers,
        timeout: timeoutMs,
      });
      return response.data;
    } catch (error) {
      this.handleHttpError('POST', url, error, timeoutMs);
    }
  }

  async get<T>(
    url: string,
    headersOrOptions?: Record<string, string> | RequestOptions,
  ): Promise<T> {
    const opts = normalizeOptions(headersOrOptions);
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    try {
      const response = await this.httpService.axiosRef.get<T>(url, {
        headers: opts.headers,
        timeout: timeoutMs,
      });
      return response.data;
    } catch (error) {
      this.handleHttpError('GET', url, error, timeoutMs);
    }
  }

  private handleHttpError(
    method: string,
    url: string,
    error: unknown,
    timeoutMs: number,
  ): never {
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
      this.logger.warn(`${method} ${url} timed out after ${timeoutMs}ms`);
      throw new Error(`HTTP ${method} timeout after ${timeoutMs}ms`);
    }

    if (status) {
      this.logger.warn(`${method} ${url} failed with status ${status}`);
    }

    throw error;
  }
}
