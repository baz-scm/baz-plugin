const fs = require('fs');
const path = require('path');

// Cursor-only: Cursor's `stop` hook fires once per agent turn and carries the
// token counts for that turn on its payload. Nothing persists this data — if
// we don't grab it here it's gone. We accumulate turns into a per-session
// tally file that `plan-complete.js` reads when the planning session ends.
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

const totalInput = Number(d.input_tokens) || 0;
const output = Number(d.output_tokens) || 0;
if (totalInput === 0 && output === 0) process.exit(0);

const cacheRead = Number(d.cache_read_tokens) || 0;
const cacheWrite = Number(d.cache_write_tokens) || 0;
const freshInput = Math.max(0, totalInput - cacheRead - cacheWrite);

const tallyPath = path.join('/tmp', `.baz-tokens-${sessionId}.json`);

let tally = {
  input_tokens: 0,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
  output_tokens: 0,
  api_call_count: 0,
};
try {
  const existing = fs.readFileSync(tallyPath, 'utf8');
  const parsed = JSON.parse(existing);
  if (parsed && typeof parsed === 'object') Object.assign(tally, parsed);
} catch {
  // First turn or unreadable file — start fresh.
}

tally.input_tokens += freshInput;
tally.cache_creation_tokens += cacheWrite;
tally.cache_read_tokens += cacheRead;
tally.output_tokens += output;
tally.api_call_count += 1;

try {
  fs.writeFileSync(tallyPath, JSON.stringify(tally), { mode: 0o600 });
} catch {
  // If /tmp is not writable there's nothing to do; drop silently.
}
