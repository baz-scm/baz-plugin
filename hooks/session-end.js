const fs = require('fs');
const path = require('path');
const { failSoft, readHookInput } = require('./hook-io');

failSoft();

const d = readHookInput();
if (!d) process.exit(0);

const sessionId = d.session_id || d.conversation_id || '';
if (!sessionId) process.exit(0);

// Every scratch file this plugin writes for this session. The plan text is the
// sensitive one: it is the user's proprietary design sitting in a world-readable
// /tmp. plan-complete.js deletes it as soon as it reads it, but that only covers
// the path where the hook fires and gets that far — a session that ends with the
// plan still on disk (hook not wired, an early exit, a plan the agent wrote but
// never completed) must not leave it behind.
for (const p of [
  `/tmp/.baz-plan-${sessionId}.md`,
  `/tmp/.baz-plan-pending-${sessionId}.json`,
  `/tmp/.baz-repos-${sessionId}.json`,
  `/tmp/.baz-tokens-${sessionId}.json`,
]) {
  try { fs.unlinkSync(p); } catch {}
}

// Reaper for sessions whose end we never saw: a crashed host, a platform with
// no session-end event (Cursor), or a plugin uninstalled mid-session. Anything
// older than a day cannot belong to a live session, and each name is keyed by a
// session id, so this only ever touches this plugin's own leftovers.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Also matches a `.<pid>.claim` left behind by a session-end run that died
// between claiming the counter file and deleting it.
const STALE = /^\.baz-(plan|plan-pending|counts|repos|tokens)-.+\.(md|json)(\.\d+\.claim)?$/;
try {
  const now = Date.now();
  for (const name of fs.readdirSync('/tmp')) {
    if (!STALE.test(name)) continue;
    const p = path.join('/tmp', name);
    try {
      if (now - fs.statSync(p).mtimeMs > MAX_AGE_MS) fs.unlinkSync(p);
    } catch {}
  }
} catch {}

const logPath = `/tmp/.baz-counts-${sessionId}.json`;

// Claim the counter file before reading it. On Codex this hook runs on every
// `Stop`, so two turns ending close together would both read a plain
// read-then-delete and print the same summary twice. rename(2) is atomic: the
// loser gets ENOENT and exits quietly, and the claimed name is what we read.
const claimPath = `${logPath}.${process.pid}.claim`;
try {
  fs.renameSync(logPath, claimPath);
} catch {
  process.exit(0);
}

let raw = null;
try {
  raw = fs.readFileSync(claimPath, 'utf8');
} catch {}
// Unlink before any exit path — `process.exit` skips `finally`.
try { fs.unlinkSync(claimPath); } catch {}
if (raw === null) process.exit(0);

const lines = raw.split('\n').filter(Boolean);

const counts = {};
for (const tool of lines) counts[tool] = (counts[tool] || 0) + 1;

const total = lines.length;
if (!total) process.exit(0);

console.log(`\n=== Baz tool usage (${total} call${total !== 1 ? 's' : ''}) ===`);
Object.entries(counts)
  .sort(([, a], [, b]) => b - a)
  .forEach(([tool, count]) => console.log(`  ${tool}: ${count}`));
