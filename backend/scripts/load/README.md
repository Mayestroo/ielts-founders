# Load Test Harness

This folder contains a repeatable load-testing harness for Part 5 concurrency validation.

## 1) Seed synthetic users and assignments

From `backend/`:

```bash
npm run perf:seed -- --users 100 --password test_password --reset true
```

Default behavior:
- Creates/uses center `Load Test Center`
- Creates/uses teacher `load_teacher`
- Creates/uses section `load-reading-section`
- Creates users `load_student_0001..N`
- Ensures one `ASSIGNED` assignment per user for the load section

## 2) Run profile tests

```bash
npm run perf:run:10
npm run perf:run:50
npm run perf:run:100
```

Or custom run:

```bash
npm run perf:run -- --profile custom --users 20 --duration 300 --ramp 60 --password test_password
```

Common flags:
- `--base-url http://localhost:3000` (script auto-appends `/api`)
- `--section-id load-reading-section`
- `--prefix load_student_`
- `--pad-width 4`
- `--submit true|false`
- `--enforce-thresholds true|false` (defaults off for `custom`, on for named profiles)

## 3) Fault injection schedule (optional)

Create a JSON file with timed shell commands and pass `--fault-file`.

To use the built-in chaos controls, start backend with:

```bash
ENABLE_CHAOS_TESTING=true CHAOS_TOKEN=local-chaos-token npm run start
```

Example file: `backend/scripts/load/faults.hard100.example.json`

```bash
npm run perf:run:100 -- --fault-file scripts/load/faults.hard100.example.json
```

Short-run sample fault file for accelerated tests:

```bash
npm run perf:run:100 -- --duration 600 --ramp 180 --fault-file scripts/load/faults.short.example.json
```

## Notes

- For high-concurrency testing, use separate Redis endpoints when possible:
  - Session/runtime: `SESSION_REDIS_URL` (or `SESSION_REDIS_HOST/PORT/...`)
  - Queue/worker: `QUEUE_REDIS_URL` (or `QUEUE_REDIS_HOST/PORT/...`)
- If writing evaluation is out of scope for a run, disable queue worker polling to reduce Redis pressure:
  - `DISABLE_WRITING_QUEUE_WORKER=true`
- Login and refresh endpoints are rate limited. From a single source IP, keep ramp times realistic.
- For strict 50/100-user exam simulation, run from distributed runners or temporarily adjust rate limits in a dedicated perf environment.
- The runner exits with non-zero code on failed thresholds or user-flow failures.
