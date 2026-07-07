const fs = require('fs');
const path = require('path');

// Cursor-only: Cursor's `stop` hook fires once per agent turn and carries the
// token counts for that turn on its payload, plus a stable `model_id` (with
// human-readable `model` as fallback). Nothing persists this data — if we
// don't grab it here it's gone. We accumulate turns into a per-session tally
// file that `plan-complete.js` reads when the planning session ends.
//
// Claude Code and Codex expose per-message usage inside the transcript file, so
// `plan-complete.js` reads it directly on those platforms and this hook is not
// wired up there.

const input = fs.readFileSync('/dev/stdin', 'utf8');
let d;
try { d = JSON.parse(input); } catch { process.exit(0); }

// Cursor uses `conversation_id` on some hooks and `session_id` on others.
const sessionId = d.session_id || d.conversation_id || '';
if (!sessionId) process.exit(0);

const turnInput = Number(d.input_tokens) || 0;
const turnOutput = Number(d.output_tokens) || 0;
// Prefer stable model_id; fall back to display name `model` if only that's set.
const turnModelId =
  (typeof d.model_id === 'string' && d.model_id) ||
  (typeof d.model === 'string' && d.model) ||
  '';

if (turnInput === 0 && turnOutput === 0 && !turnModelId) process.exit(0);

const tallyPath = path.join('/tmp', `.baz-tokens-${sessionId}.json`);

let tally = { input_tokens: 0, output_tokens: 0, model_id: '' };
try {
  const existing = fs.readFileSync(tallyPath, 'utf8');
  const parsed = JSON.parse(existing);
  if (parsed && typeof parsed === 'object') {
    tally.input_tokens = Number(parsed.input_tokens) || 0;
    tally.output_tokens = Number(parsed.output_tokens) || 0;
    if (typeof parsed.model_id === 'string') tally.model_id = parsed.model_id;
  }
} catch {
  // First turn or unreadable file — start fresh.
}

tally.input_tokens += turnInput;
tally.output_tokens += turnOutput;
// Last-write-wins across turns — model shouldn't change mid-session, but if it
// does the latest is the one the plan was authored with.
if (turnModelId) tally.model_id = turnModelId;

try {
  fs.writeFileSync(tallyPath, JSON.stringify(tally), { mode: 0o600 });
} catch {
  // If /tmp is not writable there's nothing to do; drop silently.
}
