import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { HttpClient } from '../interfaces/http-client.interface';

@Injectable()
export class AxiosHttpClient implements HttpClient {
  constructor(private readonly httpService: HttpService) {}

  async post<T>(
    url: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const response = await this.httpService.axiosRef.post<T>(url, body, {
      headers,
    });
    return response.data;
  }

  async get<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const response = await this.httpService.axiosRef.get<T>(url, {
      headers,
    });
    return response.data;
  }
}
