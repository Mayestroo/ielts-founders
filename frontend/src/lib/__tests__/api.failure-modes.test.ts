import { api } from '@/lib/api';

const jsonResponse = (status: number, body: unknown): Response => {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: () => 'application/json',
    } as Headers,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
};

describe('Api failure mode simulations', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    api.logout();
    fetchMock.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('simulates brief Nginx 502: retries and succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(502, { message: 'Bad Gateway' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          active: true,
          remainingSeconds: 1200,
          syncVersion: 2,
          serverTime: new Date().toISOString(),
        }),
      );

    const responsePromise = api.heartbeat('assignment-1');

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(500);
    const result = await responsePromise;

    expect(result.active).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('simulates 10s network disconnect: sync retries and recovers', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          success: true,
          newVersion: 5,
          syncedAt: new Date().toISOString(),
        }),
      );

    const responsePromise = api.syncAnswers(
      'assignment-2',
      { q1: 'A' },
      [],
      'tab-1',
      3,
    );

    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(500);
    await jest.advanceTimersByTimeAsync(1000);

    const result = await responsePromise;

    expect(result.success).toBe(true);
    expect(result.newVersion).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('simulates concurrent 401s: uses single refresh flight', async () => {
    api.setToken('expired-token');
    api.setRefreshToken('refresh-token');

    const responses: Response[] = [
      jsonResponse(401, { message: 'Unauthorized' }),
      jsonResponse(401, { message: 'Unauthorized' }),
      jsonResponse(200, { access_token: 'new-access-token' }),
      jsonResponse(200, { id: 'user-1', username: 'alice' }),
      jsonResponse(200, { id: 'user-1', username: 'alice' }),
    ];

    fetchMock.mockImplementation(() => {
      const next = responses.shift();
      if (!next) {
        throw new Error('Unexpected fetch call');
      }
      return Promise.resolve(next);
    });

    const [profileA, profileB] = await Promise.all([api.getProfile(), api.getProfile()]);

    expect(profileA.id).toBe('user-1');
    expect(profileB.id).toBe('user-1');

    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
    expect(api.getToken()).toBe('new-access-token');
  });
});
