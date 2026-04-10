export interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface HttpClient {
  post<T>(
    url: string,
    body: unknown,
    headersOrOptions?: Record<string, string> | RequestOptions,
  ): Promise<T>;
  get<T>(
    url: string,
    headersOrOptions?: Record<string, string> | RequestOptions,
  ): Promise<T>;
}
