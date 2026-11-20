# Architecture

## Runtime and storage

[Compute](../src/server/compute.ts) loads Prisma service inputs and starts the Express application with Bun.
[Runtime initialization](../src/server/runtime.ts) creates the Postgres store, shared login, and application.
Local development uses the same initialization with DEV_DATABASE_URL.
Tests require TEST_DATABASE_URL and create isolated synthetic schemas.
Neither path falls back to the production connection.

[PostgresDatabase](../src/server/postgres.ts) keeps each transaction on one checked-out connection.
An advisory transaction lock serializes compound household changes across instances.
The cloud discards each connection when it returns to the pool.
The next checkout creates a fresh connection.
Client query timeouts and server transaction limits bound stalled requests.
Broken connections leave the pool. Catching a connection error cannot make earlier writes commit.
Database transactions do not retry after an uncertain connection failure.
Keyed HTTP saves can replay their stored result.
Multi-table exports hold one transaction snapshot.

The browser polls shared records every ten seconds while visible.
It prevents overlapping entry requests and refreshes when the page becomes visible.
Entries stay in memory. The selected date filters those entries without another entry request.
Date changes fetch only dated daily checks. Cached checks stay disabled until revalidation.
A confirmed daily check save starts a fresh read if its selected day still needs revalidation.
The new read supersedes any older pending read for that day.
Entry, task, and daily check failures update independently.
Background refresh keeps loaded entries and Latest Care visible.
It preserves drafts, selected dates, and chart interaction state during refreshes.
The service worker caches the application shell and excludes API responses.
Offline writes do not queue.
Manual entry saves use POST /api/entry-saves/:key with one UUID key per in-memory draft.
The browser retains that key through edits, failed saves, closing, and navigation.
Confirmed saves and explicit entry changes start a new key. Reloads start a new draft.
The server stores the request and response in entry_saves.
The receipt, entry, sleep changes, and Undo receipt commit in one transaction.
Concurrent requests use the household lock. Replays return the stored response before stale checks.
Changed requests under a committed key return 409. Replays never recreate deleted entries.
Receipts stay in the database and do not enter diary exports.
The browser retries keyed saves once after network failures, timeouts, malformed responses, or server errors.
Each attempt has a 25-second limit. Both attempts use the same payload and key.
Validation, authentication, stale conflicts, and caller cancellation do not trigger retries.
A failed retry retains the draft and key for manual retry.
Older clients retain the original entry endpoints. Old servers reject the new endpoint without writing.
Other uncertain writes still require a diary check before retrying.

## Shared login

AUTH_USERNAME and AUTH_PASSWORD define one household login.
Missing or partial configuration keeps diary access closed.
Username comparison ignores case. Password spaces remain exact.
Each device receives a separate 30-day session. Sign out affects only that session.
A salted scrypt verifier detects credential changes without storing the password.
Unchanged credentials preserve sessions across releases.
Credential changes revoke sessions at startup.
Old instances cannot issue sessions after the credential generation changes.
Exports exclude authentication metadata.

One persistent counter permits ten failed credential checks per fixed 15-minute window.
It covers all usernames, addresses, and service instances.
Successful logins and blocked requests do not reset or extend the window.
Existing sessions remain valid during the limit.
Failed counts commit before the server returns an error.
Blocked requests return 429 with the remaining wait in Retry-After.
This household limit also permits temporary denial of new sign-ins through deliberate failures.

## Entries, sleep, and Undo

Entries store exact UTC timestamps. Household dates and visible times use Europe/Berlin.
Feeding and Sleep without End are active. Other activities without End remain completed.
Older completed Sleep records without End have unknown durations.

Feeding, Nappy, and Bath intervals interrupt overlapping sleep.
Timed care removes its interval. Care without End stops sleep at its start.
Adding End can resume unchanged source sleep within its original bounds.
Another unfinished care record or independent sleep can prevent a duplicate restart.
Unknown-duration sleep remains unchanged.
Remaining sleep segments retain notes. Only the first segment retains findings and temperature.

sleep_sources stores original sleep and the care and segment snapshots that control restoration.
Manual sleep edits disable automatic restoration for that source.
Moving or deleting care retains existing gaps and removes that automatic source.
Assistant batches calculate sleep changes from their final proposed state.
Care and automatic sleep changes commit in one transaction.

Manual edits and End store one Undo receipt per entry in entry_undo.
New entries and Assistant changes do not create these receipts.
Undo restores the entry, automatic sleep changes, source links, and affected archives atomically.
Restored records receive higher versions. Changed related records and repeated receipts cause a conflict.
Unrelated records do not block Undo. Earlier stale sleep links remain stale.
Diary JSON exports omit Undo receipts.

Daily task keys survive rename and removal. New tasks receive new keys.
Task definition versions differ from each day's check version.
Stale task drafts cannot overwrite another device's rename.

## Time and aggregation

Unchanged time edits preserve seconds and the original autumn occurrence.
New manual ambiguous autumn times use the standard-time occurrence.
Assistant changes to ambiguous autumn times require an explicit occurrence.
Nonexistent spring times and invalid calendar dates fail validation.
Relative durations use elapsed UTC arithmetic across midnight and clock changes.
Generated times keep their exact timestamps until that field changes manually.

Dashboard durations split at household midnight. Overlapping sleep counts once.
Starts and findings count only on the start date, including findings on other activities.
An exact midnight ending does not add another day's segment.
Running durations stop at the current instant. Unknown durations remain unknown.
Empty days mean no records, not no care.

Feeding totals combine feeding subtypes without changing stored labels.
Breast balance divides Both equally and excludes unknown sides and durations.
Explicit feeding totals in notes exclude breaks. Midnight splits preserve each interval's proportion.
Start density counts each start once and joins the clock boundary with a wrapped Gaussian kernel.
The chart's clock axis can overlap during the repeated autumn hour.
Exact details retain offsets, and totals use real elapsed timestamps.

## Assistant

Assistant uses OpenRouter when OPENROUTER_API_KEY is nonblank.
The browser receives availability flags, never the key.
OPENROUTER_MODEL defaults to deepseek/deepseek-v4.1-flash-1017.
The model receives instructions and relevant diary records.
It can read days, calculate times, ask questions, and propose changes.
It has no filesystem, shell, or direct database write tools.

The server validates proposals, snapshots their targets, and requires human confirmation.
Proposals contain at most 12 instruction operations and expire after ten minutes.
Automatic sleep changes appear separately from that limit.
Confirmation rejects changed entries, daily checks, task definitions, or relevant sleep state.
A successful confirmation applies the complete proposal once in one transaction.

Messages retain chronological roles and original instruction timestamps.
Conversation limits stop before discarding earlier facts.
Explicit dates and dayparts take precedence over recent-care defaults.
For undated 12-hour input without AM or PM, use the most recent past occurrence.
An undated interval resolves its end first and places its start before that end.
Replies use the original request time. Explicit corrections override cancelled summaries.
A pending event's start correction retains its stated duration.
An existing entry's start-only edit preserves its unchanged End.

Simple sleep intervals use a server resolver before inference.
Dates, edits, batches, unsupported replies, and ambiguous autumn times use the normal clarification flow.
The datetime calculator handles elapsed minutes without model UTC arithmetic.
Structured proposal or question tools finish each response.
A text-only response cannot claim a saved record or replace a proposal.
If one requested action lacks required information, the server asks before preparing the complete group.

## Current care and optional speech

Latest Care uses the latest past Feeding and Nappy starts, independent of the selected diary date.
Elapsed times cross midnight and clock changes. A disclosure shows the exact start.
Loading, Offline, and No record distinguish unavailable data from an empty diary.

OPENROUTER_STT_MODEL defaults to qwen/qwen3-asr-0.6b. Blank disables OpenRouter recording.
The server sends validated WAV audio to the fixed OpenRouter transcription endpoint.
The recording code captures mono PCM, flushes final samples, and exports 16 kHz WAV.
It retains playback and retry after failure or weak capture.
Interruptions stop capture without automatic transcription.
The server checks PCM encoding, mono audio, 16 kHz, chunk bounds, duration, and sample alignment.
The server rejects silence, overlong recordings, truncated chunks, and audio shorter than the reported capture.
Browser WAV uploads need no external decoder in Compute. Legacy STT URLs retain their local conversion path.
The server never sends the OpenRouter key to a legacy STT URL.
Client cancellation aborts the provider request. OpenRouter requests have a 60-second timeout and no automatic retry.
Temporary diagnostics keep at most 100 recordings for up to seven days. Hourly cleanup runs in Compute and development.
A restart can remove temporary diagnostics earlier.
These checks cannot recover missing audio or establish physical microphone accuracy.

## Release assets

The build retains five complete hashed asset sets in .public-assets.
Open pages can load their uncached lazy imports after a release.
A filename collision or changed archived bytes stops the build.
Never serve new bytes under an existing hashed filename.

HTML and the service worker use no-store without file metadata validators.
Prisma normalizes timestamps. Different HTML releases can also have the same file size.
Metadata-based ETags can therefore return an incorrect 304 for old HTML.
The archive excludes HTML, service workers, source maps, and private files.
Pages older than five retained asset sets need a reload.

## Test Case Review

Keep these regression cases when changing the related behavior.

| Area | Cases |
| --- | --- |
| Shared login | Wrong username, rotating addresses, concurrent failures, exact expiry, restart, credential changes, and existing sessions. |
| Save receipts | Concurrent replay, lost responses, restart, changed requests, stale edits, deleted records, and failed create or edit receipts. |
| Transactions | Conflicting writes, concurrent confirmation, failed batches, caught timeouts, connection replacement, and consistent exports. |
| Sleep and Undo | Equal starts, both care completion orders, unfinished overlaps, manual corrections, stale links, restart, and rollback. |
| Daily tasks | Rename, removal, retained history, stale drafts, definition changes during inference, and independent check versions. |
| Time controls | Immediate Save after wheel movement, exact seconds, both autumn occurrences, spring gaps, midnight, helper cancellation, and failed saves. |
| Assistant | Long clarification history, explicit corrections, mixed batches, unresolved actions, tool execution, and text-only failure. |
| Availability | Initial failure, timeout, malformed flags, open-page enablement, focus, session expiry, and retained drafts. |
| Recording | Final samples, silence, weak signal, startup cancellation, interrupted replies, exact retry bytes, and resource cleanup. |
| Latest Care | Elapsed advancement, midnight, date navigation, future records, empty history, connection loss, and exact start disclosures. |
| Removed APIs | Signed-in requests to reminder and push routes return 404. Configuration and exports omit their fields. The client makes no related requests. |
| Retired storage | New schemas omit all retired tables, including scheduler runs. Initialization, diary edits, Undo, and exports leave existing tables unchanged. |
| Settings recovery | A task loading failure stops the loading state. Closing and opening Settings reloads the task list. |
| Diary refresh | Date navigation uses cached entries. Late check responses, hidden polling, failure recovery, saves during polling, and sign-out preserve state. |
| Export | Download content, cancellation, repeated downloads, failures, and retained drafts. |
| Assets | Old validators, same-size HTML, service worker navigation, uncached lazy imports, collisions, exclusions, and complete-release pruning. |

Browser checks wait for successful writes before reading stored records.
Failure and offline checks retain their draft and error assertions.
Fixtures close listeners and remove synthetic schemas after setup failures.
Browser emulation does not replace physical Safari, VoiceOver, or microphone checks.
