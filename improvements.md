CRITICAL ISSUES
Backend
#	Issue	File
C1	Silent data loss - writing evaluation events swallowed when dependencies missing, no retry or persistence	exam-event.listener.ts
C2	Process starvation - 2 sequential OpenAI calls (45s timeout each) block the HTTP handler synchronously	submission.service.ts
C3	JWT token forgery - fallback to literal 'secret' / 'secret-refresh' when env vars missing	auth.service.ts
C4	Infinite recursion - heartbeat re-calls itself when Redis is down with no depth limit	exam-session.service.ts
C5	210MB JSON body limit - DoS vector, 210x default size	main.ts
Frontend
#	Issue	File
C6	Side effect inside React state updater - async network call inside setAnswers(prev => ...) violates React purity rules	page.tsx (exam)
C7	Inverted regex character range - [\u2013-] matches dozens of unintended Unicode chars	features/exam/utils.ts
C8	Non-null assertion crash - !.match()![1] throws if regex doesn't match	WritingSection.tsx
C9	Speaking upload race condition - audio saved under wrong question ID when user navigates during upload	SpeakingSection.tsx
C10	Anti-cheat is entirely client-side - trivially bypassed by opening DevTools before page load, disabling JS, etc.	hooks/useAntiCheat.ts
C11	Monolithic exam page - 2397 lines violating SRP, impossible to test or maintain	page.tsx (exam)
Admin Panel
#	Issue	File
C12	~3300 lines of duplicate code - create and edit exam pages are 95% identical	create/page.tsx + edit/page.tsx
C13	Missing Suspense boundary for useSearchParams() - will cause Next.js build warnings/errors	assignments/page.tsx
C14	confirm() dialog + mutative logic bug - form type changes before user confirms, leaves inconsistent state on cancel	edit/page.tsx
Security (Cross-cutting)
#	Issue
C15	Live credentials on disk - creds.txt contains real DB password, JWT secrets, Redis passwords, chaos token
MAJOR ISSUES
Backend
#	Issue	File
M1	260 lines of duplicated scoring logic across 3 files (buildSectionResult, evaluateTaskInputs, emptyScores, roundBand)	writing-evaluation.service.ts, processor.ts, listener.ts
M2	Excessive any types in users.service.ts (WHERE builder, sanitize methods)	users.service.ts
M3	SSRF via image URLs - user-controlled URLs passed to OpenAI API with insufficient validation	ai.service.ts
M4	Fire-and-forget DB writes with no backpressure in sync checkpoint	exam-session.service.ts
M5	Unsafe as casts throughout submission pipeline - no runtime validation on JSON shapes	multiple files
M6	Speaking "all parts required" validation inconsistent with evaluation logic	submission.service.ts
M7	Cache over-invalidation - 6 prefix patterns deleted on every write, many unnecessary	assignment.service.ts, submission.service.ts, result.service.ts
M8	No input validation on answers JSON - arbitrary size/structure stored as Prisma.InputJsonValue	assignment.service.ts
Frontend
#	Issue	File
M9	Unsafe ref assertions - as unknown as RefObject<T> lies about nullability, ref.current.play() crashes before mount	page.tsx (exam)
M10	performance.getEntriesByType throws in Safari private browsing/WebView	page.tsx (exam)
M11	any type leak in type definitions (Record<string, any>) cascades through all downstream code	types/index.ts
M12	Text selection conflict - anti-cheat disables globally (userSelect: none), HighlightableText re-enables, CSS cascade issues	useAntiCheat.ts:35 + HighlightableText.tsx:593,608
M13	Stale debounce closure in syncAnswers - timeout not tracked in root effect cleanup	hooks/useExamSession.ts
M14	Missing refocus on WritingTask switch - textarea retains old task focus when switching	WritingSection.tsx + WritingTask.tsx
M15	localStorage access without try-catch in module-scoped initializers - throws in Safari private browsing	SettingsContext.tsx
M16	Hardcoded listening part ranges (4x10) - breaks for non-standard configurations	useExamParts.ts
M17	Reusable resolveWritingTaskNumber duplicated in 2 files	page.tsx:215-233 + useExamParts.ts:10-39
Admin Panel
#	Issue	File
M18	Client-side pagination fetches all 1000 results - won't scale	results/page.tsx
M19	Unhandled promise rejections via void operator in multiple places	users/page.tsx:469,479, downloads/page.tsx:570, api.ts:90
M20	Button inside Link - invalid HTML (<button> inside <a>)	exams/page.tsx
M21	imageUrl marked required on Writing Task 1 - images are optional	create/page.tsx:845, edit/page.tsx:901
M22	Race condition in handleToggleResultsVisibilityBySession - stale closure in functional updater	assignments/page.tsx
M23	Audio() resource leak - not cleaned up on unmount, promise never resolves	create/page.tsx:144-170, edit/page.tsx:142-168
M24	20 buttons missing type="button" - default to submit inside forms	create/page.tsx (8 places), edit/page.tsx (8 places)
MINOR / CODE QUALITY ISSUES (Selected Highlights)
Backend (21 minor issues)
- [PERF-FIX] comment stubs referencing non-existent /performance-audit/ documentation (6 files)
- Duplicate sanitizeSectionForStudent in 2 files
- Duplicate countWords in 3 files
- 4 inline Lua scripts (~190 lines) with no syntax checking or tests
- Ineffective rate limits (6000 req/min on student endpoints - 50x the global limit)
- Dead code: centerId ?? fallback where equality is guaranteed
- hasOwnProperty should be modern Object.hasOwn()
- Character-by-character regex for English-only detection (6000 regex runs per essay)
- runtimeFaultService runs in production request pipeline for every request
Frontend (11 minor issues)
- Unsafe as any cast on setAnswer(questionId, value as any) - unnecessary
- Redundant formatTime recreated inside useCallback hook
- Math.random() for toast IDs (collision risk) in ToastContext.tsx:29
- navigator.onLine unreliable for offline detection (false positives)
- Module-level mutable registry Map in examNotesStore.ts leaks on unmount
- Duplicate Escape key handling in exam page + anti-cheat hook
- console.log calls present in production code paths
- handleFinalSubmit has 27 dependencies in useCallback array
- 50+ individual props drilled into section components (prop drilling anti-pattern)
Admin Panel (17 minor issues)
- pageSize stored as useState(10) - never updated, should be const
- Index as key={i} on pagination buttons
- toLocaleDateString() without locale - inconsistent across browsers
- Math.random() for toast IDs in ToastContext.tsx:29
- scrollbar-thin / scrollbar-thumb-slate-200 are non-standard Tailwind classes
- m17 - response type mismatch: resultsVisibleToStudent vs showResultsToStudent in API client
- Mutation onSuccess invalidates overly broad query keys
- Toaster auto-close setTimeout fires after manual close (double onClose call)
NON-CTO WRITTEN CODE PATTERNS (AI-Generated Indicators)
The following patterns strongly suggest portions were AI-generated:
1. [PERF-FIX] comment stubs
Files contain // [PERF-FIX] … see /performance-audit/ comments referencing documentation that does not exist anywhere in the project. This is a hallmark of AI hallucinating cross-references.
2. Verbose JSDoc explaining trivial logic
25-line JSDoc on a 3-line getter function (extractFullMockSessionId). AI tendency to over-document simple code.
3. ~95% identical 1600-line files
exams/create/page.tsx and exams/[id]/edit/page.tsx are nearly identical. Classic pattern: AI generated the edit page from the create page context.
4. Mechanical catch(error) blocks
Exact same 2-3 line error-stringification pattern repeated 15+ times across the codebase.
5. as Question / as any quick-fix casts
AI tendency to "cast to fix the type error" rather than properly constructing union types or using type guards.
6. Inline SVG paths
8 full SVG definitions inlined in dashboard/layout.tsx instead of extracted Icon components.
7. Over-engineered functional updates
setPendingVisibilitySessionId((current) => current === sessionId ? null : current) - clever but wrong (stale closure).
8. Math.random() for ID generation
Used in both ToastContext.tsx places instead of crypto.randomUUID().
ARCHITECTURAL OBSERVATIONS
What's well done:
- Sub-module pattern (ExamsModule -> ExamContentModule, ExamRuntimeModule, ExamEvaluationModule)
- Redis-backed exam sessions with atomic Lua scripts and graceful DB fallback
- Optional BullMQ queue with inline processing fallback
- Proper separation of admin-panel, student frontend, and API
- Centralized query key management in both frontends
- Good TypeScript config (strict mode everywhere)
- Multi-stage Docker builds with standalone Next.js output
Architecture concerns:
- No BFF (Backend For Frontend) pattern - both frontends talk directly to the API, leaking internal endpoints
- No API versioning (no /v1/ prefix) - will break all clients on breaking changes
- No integration tests found in any app (0 spec files in backend/src, no e2e tests)
- No error boundaries in React apps - a crash in any section component takes down the entire exam
- No server actions or API routes in either frontend - they're pure SPAs
- No rate limiting at nginx level for login endpoint in Docker mode (only PM2 nginx config has login_limit)
- prisma migrate dev mentioned in scripts - should use prisma migrate deploy for production