#!/usr/bin/env ts-node

import { exec as execCallback } from 'child_process';
import { readFile } from 'fs/promises';
import 'dotenv/config';
import { performance } from 'perf_hooks';
import { promisify } from 'util';

const exec = promisify(execCallback);

type CliArgs = Record<string, string | boolean>;
type ProfileName = 'baseline10' | 'preprod50' | 'hard100' | 'custom';

interface LoadProfile {
  users: number;
  durationSeconds: number;
  rampSeconds: number;
  syncIntervalMs: number;
  heartbeatIntervalMs: number;
  reconnectEveryMs: number;
  submitAtEnd: boolean;
  maxConsecutiveFailures: number;
  syncP95MsTarget?: number;
  heartbeatP95MsTarget?: number;
  submitP95MsTarget?: number;
  maxErrorRatePct?: number;
  minSubmitSuccessPct?: number;
}

interface RunConfig {
  baseUrl: string;
  profileName: ProfileName;
  profile: LoadProfile;
  enforceThresholds: boolean;
  prefix: string;
  padWidth: number;
  password: string;
  sectionId?: string;
  faultFile?: string;
}

interface FaultStep {
  atSeconds: number;
  command: string;
  label?: string;
  timeoutMs?: number;
}

interface EndpointStats {
  total: number;
  ok: number;
  failed: number;
  latenciesMs: number[];
  statuses: Map<string, number>;
}

interface EndpointSnapshot {
  endpoint: string;
  total: number;
  ok: number;
  failed: number;
  errorRatePct: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

interface ThresholdCheck {
  label: string;
  passed: boolean;
  details: string;
}

interface VirtualUserResult {
  username: string;
  success: boolean;
  submitted: boolean;
  reason?: string;
}

interface LoginResponse {
  access_token: string;
}

interface AssignmentSummary {
  id: string;
  sectionId: string;
  status: 'ASSIGNED' | 'IN_PROGRESS' | 'SUBMITTED';
}

interface QuestionDescriptor {
  id?: string;
  type?: string;
  options?: Array<{ id?: string }>;
}

interface AssignmentDetails {
  id: string;
  section?: {
    questions?: QuestionDescriptor[];
  };
}

interface SyncResponse {
  success?: boolean;
  action?: string;
  newVersion?: number;
}

interface HeartbeatResponse {
  active: boolean;
  syncVersion?: number;
}

interface ReconnectResponse {
  success?: boolean;
  syncVersion?: number;
}

const PROFILE_DEFAULTS: Record<'baseline10' | 'preprod50' | 'hard100', LoadProfile> = {
  baseline10: {
    users: 10,
    durationSeconds: 20 * 60,
    rampSeconds: 90,
    syncIntervalMs: 10000,
    heartbeatIntervalMs: 30000,
    reconnectEveryMs: 0,
    submitAtEnd: true,
    maxConsecutiveFailures: 10,
    syncP95MsTarget: 300,
    heartbeatP95MsTarget: 200,
    maxErrorRatePct: 0.2,
    minSubmitSuccessPct: 100,
  },
  preprod50: {
    users: 50,
    durationSeconds: 45 * 60,
    rampSeconds: 5 * 60,
    syncIntervalMs: 10000,
    heartbeatIntervalMs: 30000,
    reconnectEveryMs: 3 * 60 * 1000,
    submitAtEnd: true,
    maxConsecutiveFailures: 12,
    syncP95MsTarget: 700,
    submitP95MsTarget: 1500,
    maxErrorRatePct: 1,
    minSubmitSuccessPct: 100,
  },
  hard100: {
    users: 100,
    durationSeconds: 60 * 60,
    rampSeconds: 10 * 60,
    syncIntervalMs: 10000,
    heartbeatIntervalMs: 30000,
    reconnectEveryMs: 3 * 60 * 1000,
    submitAtEnd: true,
    maxConsecutiveFailures: 15,
    maxErrorRatePct: 1.5,
    minSubmitSuccessPct: 99,
  },
};

class MetricsCollector {
  private readonly stats = new Map<string, EndpointStats>();

  record(endpoint: string, latencyMs: number, ok: boolean, status: string) {
    const existing = this.stats.get(endpoint) || {
      total: 0,
      ok: 0,
      failed: 0,
      latenciesMs: [],
      statuses: new Map<string, number>(),
    };

    existing.total += 1;
    existing.latenciesMs.push(latencyMs);

    if (ok) {
      existing.ok += 1;
    } else {
      existing.failed += 1;
    }

    existing.statuses.set(status, (existing.statuses.get(status) || 0) + 1);
    this.stats.set(endpoint, existing);
  }

  totalRequests() {
    let total = 0;
    for (const endpointStats of this.stats.values()) {
      total += endpointStats.total;
    }
    return total;
  }

  totalFailures() {
    let total = 0;
    for (const endpointStats of this.stats.values()) {
      total += endpointStats.failed;
    }
    return total;
  }

  getEndpointSnapshot(endpoint: string): EndpointSnapshot {
    const stats = this.stats.get(endpoint);
    if (!stats) {
      return {
        endpoint,
        total: 0,
        ok: 0,
        failed: 0,
        errorRatePct: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        maxMs: 0,
      };
    }

    const sorted = [...stats.latenciesMs].sort((a, b) => a - b);
    const maxMs = sorted.length > 0 ? sorted[sorted.length - 1] : 0;

    return {
      endpoint,
      total: stats.total,
      ok: stats.ok,
      failed: stats.failed,
      errorRatePct: stats.total > 0 ? (stats.failed / stats.total) * 100 : 0,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      maxMs,
    };
  }

  snapshot(): EndpointSnapshot[] {
    return [...this.stats.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map((endpoint) => this.getEndpointSnapshot(endpoint));
  }
}

function percentile(sortedValues: number[], pct: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sortedValues.length) - 1),
  );
  return Number(sortedValues[index].toFixed(2));
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    i += 1;
  }

  return parsed;
}

function readString(args: CliArgs, key: string, fallback: string): string {
  const value = args[key];
  return typeof value === 'string' ? value : fallback;
}

function readNumber(
  args: CliArgs,
  key: string,
  fallback: number,
  min: number,
): number {
  const value = args[key];
  if (typeof value !== 'string') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }

  return parsed;
}

function readBoolean(args: CliArgs, key: string, fallback: boolean): boolean {
  const value = args[key];
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeBaseUrl(raw: string): string {
  const normalized = raw.trim().replace(/\/+$/, '');
  if (normalized.endsWith('/api')) {
    return normalized;
  }

  return `${normalized}/api`;
}

function usage() {
  console.log('Usage: npm run perf:run -- [options]');
  console.log('');
  console.log('Options:');
  console.log('  --profile <baseline10|preprod50|hard100|custom>');
  console.log('  --base-url <url>              API host, with or without /api');
  console.log('  --users <n>                   Override virtual user count');
  console.log('  --duration <seconds>          Override steady-state duration');
  console.log('  --ramp <seconds>              Override ramp duration');
  console.log('  --sync-ms <n>                 Sync interval ms');
  console.log('  --heartbeat-ms <n>            Heartbeat interval ms');
  console.log('  --reconnect-ms <n>            Reconnect cadence ms (0 disables)');
  console.log('  --submit <true|false>         Submit at end');
  console.log('  --prefix <value>              Username prefix (default: load_student_)');
  console.log('  --pad-width <n>               Username index width (default: 4)');
  console.log('  --password <value>            Shared student password');
  console.log('  --section-id <id>             Restrict assignment selection');
  console.log('  --fault-file <path>           JSON fault schedule file');
  console.log('  --enforce-thresholds <true|false>');
  console.log('  --help                        Show this message');
}

function createConfig(args: CliArgs): RunConfig {
  const requestedProfile = readString(args, 'profile', 'baseline10') as ProfileName;
  const profileName: ProfileName =
    requestedProfile === 'preprod50' ||
    requestedProfile === 'hard100' ||
    requestedProfile === 'custom' ||
    requestedProfile === 'baseline10'
      ? requestedProfile
      : 'baseline10';

  const baseProfile: LoadProfile =
    profileName === 'custom'
      ? { ...PROFILE_DEFAULTS.baseline10 }
      : { ...PROFILE_DEFAULTS[profileName] };

  const profile: LoadProfile = {
    ...baseProfile,
    users: readNumber(args, 'users', baseProfile.users, 1),
    durationSeconds: readNumber(args, 'duration', baseProfile.durationSeconds, 1),
    rampSeconds: readNumber(args, 'ramp', baseProfile.rampSeconds, 0),
    syncIntervalMs: readNumber(args, 'sync-ms', baseProfile.syncIntervalMs, 500),
    heartbeatIntervalMs: readNumber(
      args,
      'heartbeat-ms',
      baseProfile.heartbeatIntervalMs,
      1000,
    ),
    reconnectEveryMs: readNumber(
      args,
      'reconnect-ms',
      baseProfile.reconnectEveryMs,
      0,
    ),
    submitAtEnd: readBoolean(args, 'submit', baseProfile.submitAtEnd),
    maxConsecutiveFailures: readNumber(
      args,
      'max-failures',
      baseProfile.maxConsecutiveFailures,
      1,
    ),
  };

  return {
    baseUrl: normalizeBaseUrl(
      readString(args, 'base-url', process.env.LOAD_TEST_BASE_URL || 'http://localhost:3000'),
    ),
    profileName,
    profile,
    enforceThresholds: readBoolean(
      args,
      'enforce-thresholds',
      profileName !== 'custom',
    ),
    prefix: readString(args, 'prefix', 'load_student_'),
    padWidth: readNumber(args, 'pad-width', 4, 1),
    password: readString(args, 'password', process.env.LOAD_TEST_PASSWORD || 'load_password'),
    sectionId: readString(args, 'section-id', '').trim() || undefined,
    faultFile: readString(args, 'fault-file', '').trim() || undefined,
  };
}

function buildUsername(prefix: string, padWidth: number, index: number): string {
  return `${prefix}${String(index).padStart(padWidth, '0')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function jitter(baseMs: number, ratio: number): number {
  const variation = baseMs * ratio;
  return Math.max(100, Math.round(baseMs + (Math.random() * 2 - 1) * variation));
}

function randomAnswer(question: QuestionDescriptor): unknown {
  const type = question.type || 'FILL_BLANK';
  if (type === 'MCQ_MULTIPLE') {
    if (Array.isArray(question.options) && question.options.length > 0) {
      return [question.options[0]?.id || 'a'];
    }
    return ['a'];
  }

  if (type === 'MCQ_SINGLE') {
    if (Array.isArray(question.options) && question.options.length > 0) {
      const pick = question.options[Math.floor(Math.random() * question.options.length)];
      return pick?.id || 'a';
    }
    return 'a';
  }

  if (type === 'TRUE_FALSE_NOT_GIVEN' || type === 'YES_NO_NOT_GIVEN') {
    const pool = ['TRUE', 'FALSE', 'NOT_GIVEN'];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  return `ans-${Math.floor(Math.random() * 1000)}`;
}

async function requestJson<T>(
  metrics: MetricsCollector,
  endpoint: string,
  baseUrl: string,
  path: string,
  method: 'GET' | 'POST',
  token?: string,
  body?: unknown,
  timeoutMs = 15000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  let recorded = false;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const latencyMs = Number((performance.now() - started).toFixed(2));

    if (!response.ok) {
      metrics.record(endpoint, latencyMs, false, String(response.status));
      recorded = true;

      const contentType = response.headers.get('content-type') || '';
      let message = `HTTP ${response.status}`;
      if (contentType.includes('application/json')) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        if (payload?.message) {
          message = payload.message;
        }
      } else {
        const text = await response.text().catch(() => '');
        if (text) {
          message = text;
        }
      }

      throw new Error(`${endpoint} failed: ${message}`);
    }

    metrics.record(endpoint, latencyMs, true, String(response.status));

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }

    return (await response.text()) as T;
  } catch (error) {
    if (!recorded) {
      const status =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'TIMEOUT'
          : 'EXCEPTION';
      const latencyMs = Number((performance.now() - started).toFixed(2));
      metrics.record(endpoint, latencyMs, false, status);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runVirtualUser(
  index: number,
  config: RunConfig,
  metrics: MetricsCollector,
): Promise<VirtualUserResult> {
  const username = buildUsername(config.prefix, config.padWidth, index);
  const tabId = `${username}-tab-${Math.floor(Math.random() * 100000)}`;

  try {
    const login = await requestJson<LoginResponse>(
      metrics,
      'auth.login',
      config.baseUrl,
      '/auth/login',
      'POST',
      undefined,
      {
        username,
        password: config.password,
      },
      15000,
    );

    const token = login.access_token;
    if (!token) {
      throw new Error('missing access token');
    }

    const assignments = await requestJson<AssignmentSummary[]>(
      metrics,
      'assignments.my',
      config.baseUrl,
      '/assignments/my',
      'GET',
      token,
      undefined,
      15000,
    );

    const candidates = assignments.filter((assignment) => {
      if (assignment.status === 'SUBMITTED') {
        return false;
      }
      if (config.sectionId && assignment.sectionId !== config.sectionId) {
        return false;
      }
      return true;
    });

    if (candidates.length === 0) {
      throw new Error('no usable assignment found');
    }

    const activeAssignment = candidates[0];

    const details = await requestJson<AssignmentDetails>(
      metrics,
      'assignments.detail',
      config.baseUrl,
      `/assignments/${activeAssignment.id}`,
      'GET',
      token,
      undefined,
      15000,
    );

    const questions = Array.isArray(details.section?.questions)
      ? details.section?.questions.filter((item) => item?.id)
      : [];

    if (activeAssignment.status === 'ASSIGNED') {
      await requestJson(
        metrics,
        'assignments.start',
        config.baseUrl,
        `/assignments/${activeAssignment.id}/start`,
        'POST',
        token,
        {},
        20000,
      );
    }

    let answers: Record<string, unknown> = {};
    let syncVersion = 0;

    const initialReconnect = await requestJson<ReconnectResponse>(
      metrics,
      'assignments.reconnect',
      config.baseUrl,
      `/assignments/${activeAssignment.id}/reconnect`,
      'POST',
      token,
      {
        clientAnswers: answers,
        tabId,
      },
      15000,
    );

    if (typeof initialReconnect.syncVersion === 'number') {
      syncVersion = initialReconnect.syncVersion;
    }

    const startedAt = Date.now();
    const deadline = startedAt + config.profile.durationSeconds * 1000;

    let nextSyncAt = startedAt + jitter(config.profile.syncIntervalMs, 0.25);
    let nextHeartbeatAt = startedAt + jitter(config.profile.heartbeatIntervalMs, 0.1);
    let nextReconnectAt =
      config.profile.reconnectEveryMs > 0
        ? startedAt + config.profile.reconnectEveryMs
        : Number.POSITIVE_INFINITY;

    let consecutiveFailures = 0;

    while (Date.now() < deadline) {
      const now = Date.now();
      let didWork = false;

      if (now >= nextSyncAt) {
        const question =
          questions[Math.floor(Math.random() * questions.length)] ||
          ({ id: 'q1', type: 'FILL_BLANK' } as QuestionDescriptor);
        const key = String(question.id || 'q1');
        answers = {
          ...answers,
          [key]: randomAnswer(question),
        };

        try {
          const syncResponse = await requestJson<SyncResponse>(
            metrics,
            'assignments.sync',
            config.baseUrl,
            `/assignments/${activeAssignment.id}/sync`,
            'POST',
            token,
            {
              answers,
              highlights: [],
              syncVersion,
              tabId,
            },
            15000,
          );

          consecutiveFailures = 0;

          if (syncResponse.success === false && syncResponse.action === 'refresh') {
            const reconnectResponse = await requestJson<ReconnectResponse>(
              metrics,
              'assignments.reconnect',
              config.baseUrl,
              `/assignments/${activeAssignment.id}/reconnect`,
              'POST',
              token,
              {
                clientAnswers: answers,
                tabId,
              },
              15000,
            );

            if (typeof reconnectResponse.syncVersion === 'number') {
              syncVersion = reconnectResponse.syncVersion;
            }
          } else if (typeof syncResponse.newVersion === 'number') {
            syncVersion = syncResponse.newVersion;
          }
        } catch {
          consecutiveFailures += 1;
          if (consecutiveFailures >= config.profile.maxConsecutiveFailures) {
            throw new Error('too many consecutive sync/heartbeat failures');
          }
        }

        nextSyncAt = now + jitter(config.profile.syncIntervalMs, 0.25);
        didWork = true;
      }

      if (now >= nextHeartbeatAt) {
        try {
          const heartbeat = await requestJson<HeartbeatResponse>(
            metrics,
            'assignments.heartbeat',
            config.baseUrl,
            `/assignments/${activeAssignment.id}/heartbeat`,
            'POST',
            token,
            { tabId },
            15000,
          );

          consecutiveFailures = 0;

          if (!heartbeat.active) {
            break;
          }

          if (
            typeof heartbeat.syncVersion === 'number' &&
            heartbeat.syncVersion > syncVersion
          ) {
            syncVersion = heartbeat.syncVersion;
          }
        } catch {
          consecutiveFailures += 1;
          if (consecutiveFailures >= config.profile.maxConsecutiveFailures) {
            throw new Error('too many consecutive sync/heartbeat failures');
          }
        }

        nextHeartbeatAt = now + jitter(config.profile.heartbeatIntervalMs, 0.1);
        didWork = true;
      }

      if (now >= nextReconnectAt) {
        try {
          const reconnect = await requestJson<ReconnectResponse>(
            metrics,
            'assignments.reconnect',
            config.baseUrl,
            `/assignments/${activeAssignment.id}/reconnect`,
            'POST',
            token,
            {
              clientAnswers: answers,
              tabId,
            },
            15000,
          );

          if (typeof reconnect.syncVersion === 'number') {
            syncVersion = reconnect.syncVersion;
          }

          consecutiveFailures = 0;
        } catch {
          consecutiveFailures += 1;
          if (consecutiveFailures >= config.profile.maxConsecutiveFailures) {
            throw new Error('too many reconnect failures');
          }
        }

        nextReconnectAt =
          config.profile.reconnectEveryMs > 0
            ? now + config.profile.reconnectEveryMs
            : Number.POSITIVE_INFINITY;
        didWork = true;
      }

      if (!didWork) {
        await sleep(120);
      }
    }

    let submitted = false;
    if (config.profile.submitAtEnd) {
      await requestJson(
        metrics,
        'assignments.submit',
        config.baseUrl,
        `/assignments/${activeAssignment.id}/submit`,
        'POST',
        token,
        {
          answers,
          tabId,
        },
        30000,
      );
      submitted = true;
    }

    return {
      username,
      success: true,
      submitted,
    };
  } catch (error) {
    return {
      username,
      success: false,
      submitted: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function loadFaultSteps(path: string): Promise<FaultStep[]> {
  const content = await readFile(path, 'utf-8');
  const parsed = JSON.parse(content) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('fault file must be a JSON array');
  }

  return parsed
    .map((entry) => {
      const item = entry as Partial<FaultStep>;
      return {
        atSeconds: Number(item.atSeconds),
        command: String(item.command || ''),
        label: item.label ? String(item.label) : undefined,
        timeoutMs: item.timeoutMs ? Number(item.timeoutMs) : 20000,
      };
    })
    .filter(
      (item) =>
        Number.isFinite(item.atSeconds) && item.atSeconds >= 0 && item.command.length > 0,
    )
    .sort((a, b) => a.atSeconds - b.atSeconds);
}

function scheduleFaults(faults: FaultStep[]) {
  const timers: NodeJS.Timeout[] = [];

  for (const fault of faults) {
    const timer = setTimeout(async () => {
      const label = fault.label || fault.command;
      console.log(`[fault] running at +${fault.atSeconds}s: ${label}`);

      try {
        await exec(fault.command, {
          timeout: fault.timeoutMs || 20000,
        });
        console.log(`[fault] completed: ${label}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[fault] failed: ${label} (${message})`);
      }
    }, fault.atSeconds * 1000);

    timers.push(timer);
  }

  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
  };
}

function evaluateThresholds(
  config: RunConfig,
  metrics: MetricsCollector,
  userResults: VirtualUserResult[],
): ThresholdCheck[] {
  const checks: ThresholdCheck[] = [];

  const totalRequests = metrics.totalRequests();
  const totalFailures = metrics.totalFailures();
  const overallErrorRate =
    totalRequests > 0 ? Number(((totalFailures / totalRequests) * 100).toFixed(3)) : 0;

  const submittedUsers = userResults.filter((result) => result.submitted).length;
  const submitSuccessRate =
    userResults.length > 0
      ? Number(((submittedUsers / userResults.length) * 100).toFixed(2))
      : 0;

  if (typeof config.profile.maxErrorRatePct === 'number') {
    checks.push({
      label: 'overall error rate',
      passed: overallErrorRate <= config.profile.maxErrorRatePct,
      details: `${overallErrorRate}% <= ${config.profile.maxErrorRatePct}%`,
    });
  }

  if (typeof config.profile.minSubmitSuccessPct === 'number' && config.profile.submitAtEnd) {
    checks.push({
      label: 'submit success rate',
      passed: submitSuccessRate >= config.profile.minSubmitSuccessPct,
      details: `${submitSuccessRate}% >= ${config.profile.minSubmitSuccessPct}%`,
    });
  }

  if (typeof config.profile.syncP95MsTarget === 'number') {
    const sync = metrics.getEndpointSnapshot('assignments.sync');
    checks.push({
      label: 'sync p95',
      passed: sync.p95Ms <= config.profile.syncP95MsTarget,
      details: `${sync.p95Ms}ms <= ${config.profile.syncP95MsTarget}ms`,
    });
  }

  if (typeof config.profile.heartbeatP95MsTarget === 'number') {
    const heartbeat = metrics.getEndpointSnapshot('assignments.heartbeat');
    checks.push({
      label: 'heartbeat p95',
      passed: heartbeat.p95Ms <= config.profile.heartbeatP95MsTarget,
      details: `${heartbeat.p95Ms}ms <= ${config.profile.heartbeatP95MsTarget}ms`,
    });
  }

  if (typeof config.profile.submitP95MsTarget === 'number' && config.profile.submitAtEnd) {
    const submit = metrics.getEndpointSnapshot('assignments.submit');
    checks.push({
      label: 'submit p95',
      passed: submit.p95Ms <= config.profile.submitP95MsTarget,
      details: `${submit.p95Ms}ms <= ${config.profile.submitP95MsTarget}ms`,
    });
  }

  return checks;
}

function printReport(
  config: RunConfig,
  metrics: MetricsCollector,
  userResults: VirtualUserResult[],
  durationMs: number,
) {
  const snapshots = metrics.snapshot();
  const totalRequests = metrics.totalRequests();
  const totalFailures = metrics.totalFailures();

  const successfulUsers = userResults.filter((result) => result.success).length;
  const submittedUsers = userResults.filter((result) => result.submitted).length;

  console.log('');
  console.log('Load test finished.');
  console.log(`Profile: ${config.profileName}`);
  console.log(`Base URL: ${config.baseUrl}`);
  console.log(`Users: ${config.profile.users}`);
  console.log(`Wall time: ${(durationMs / 1000).toFixed(2)}s`);
  console.log(`Requests: ${totalRequests}`);
  console.log(`Failures: ${totalFailures}`);
  console.log(`Successful users: ${successfulUsers}/${userResults.length}`);
  console.log(`Submitted users: ${submittedUsers}/${userResults.length}`);

  console.log('');
  console.log('Endpoint Metrics:');
  console.log('endpoint                 calls   ok   fail   p50ms   p95ms   p99ms   maxms');
  for (const row of snapshots) {
    const line = [
      row.endpoint.padEnd(24, ' '),
      String(row.total).padStart(6, ' '),
      String(row.ok).padStart(5, ' '),
      String(row.failed).padStart(6, ' '),
      row.p50Ms.toFixed(2).padStart(7, ' '),
      row.p95Ms.toFixed(2).padStart(7, ' '),
      row.p99Ms.toFixed(2).padStart(7, ' '),
      row.maxMs.toFixed(2).padStart(7, ' '),
    ].join(' ');
    console.log(line);
  }

  const checks = evaluateThresholds(config, metrics, userResults);
  if (checks.length > 0 && config.enforceThresholds) {
    console.log('');
    console.log('Threshold Checks:');
    for (const check of checks) {
      console.log(`- ${check.passed ? 'PASS' : 'FAIL'} ${check.label}: ${check.details}`);
    }
  }

  const failedUsers = userResults.filter((result) => !result.success);
  if (failedUsers.length > 0) {
    console.log('');
    console.log('Failed Users (first 10):');
    for (const user of failedUsers.slice(0, 10)) {
      console.log(`- ${user.username}: ${user.reason || 'unknown error'}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const config = createConfig(args);
  const metrics = new MetricsCollector();

  console.log('Starting load test...');
  console.log(`Profile: ${config.profileName}`);
  console.log(`Users: ${config.profile.users}`);
  console.log(`Duration: ${config.profile.durationSeconds}s`);
  console.log(`Ramp: ${config.profile.rampSeconds}s`);
  console.log(`Base URL: ${config.baseUrl}`);
  console.log(`User prefix: ${config.prefix}`);
  console.log(`Threshold enforcement: ${config.enforceThresholds ? 'on' : 'off'}`);

  let cancelFaults: () => void = () => {};
  if (config.faultFile) {
    const faults = await loadFaultSteps(config.faultFile);
    if (faults.length > 0) {
      console.log(`Loaded ${faults.length} fault steps from ${config.faultFile}`);
      cancelFaults = scheduleFaults(faults);
    }
  }

  const runStartedAt = Date.now();

  let completedUsers = 0;
  const rampDelayMs =
    config.profile.users > 0
      ? Math.floor((config.profile.rampSeconds * 1000) / config.profile.users)
      : 0;

  const tasks = Array.from({ length: config.profile.users }, (_, idx) => {
    const userIndex = idx + 1;
    return (async () => {
      const delay = rampDelayMs * idx;
      if (delay > 0) {
        await sleep(delay);
      }

      const result = await runVirtualUser(userIndex, config, metrics);
      completedUsers += 1;

      if (completedUsers % 10 === 0 || completedUsers === config.profile.users) {
        console.log(`Progress: ${completedUsers}/${config.profile.users}`);
      }

      return result;
    })();
  });

  const results = await Promise.all(tasks);
  cancelFaults();

  const durationMs = Date.now() - runStartedAt;
  printReport(config, metrics, results, durationMs);

  const checks = evaluateThresholds(config, metrics, results);
  const anyFailedCheck = checks.some((check) => !check.passed);
  const anyFailedUser = results.some((result) => !result.success);

  if ((config.enforceThresholds && anyFailedCheck) || anyFailedUser) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Load test runner failed:', error);
  process.exit(1);
});
