const fs = require('fs');
const path = require('path');
const {
  failSoft,
  readHookInput,
  sessionIdOf,
  scratchDir,
  scratchPath,
  legacyPath,
} = require('./hook-io');

failSoft();

const d = readHookInput();
if (!d) process.exit(0);

const sessionId = sessionIdOf(d);
if (!sessionId) process.exit(0);

// argv[2] is the vendor name, passed by each platform's hook manifest. It is
// what tells us whether this event actually ends the session: Codex has no
// session-end event and fires `Stop` after every turn, so on Codex this script
// runs many times inside one live session.
//
// This is an allowlist, and it **fails closed**: only a vendor we know fires a
// terminal event gets the per-session delete. An omitted or unrecognised
// argument — an older manifest still invoking this script with no vendor, a
// future platform, a typo — must not be read as "safe to delete the plan".
const TERMINAL_VENDORS = new Set(['claude-code']);
const vendorArg = process.argv[2] || '';
const isTerminal = TERMINAL_VENDORS.has(vendorArg);

// Delete this session's scratch files — but only when the event really is the
// end of the session. On Codex `Stop` is per-turn, and the plan file, the repos
// list and the parked payload are all still being written and read by later
// turns: post-tool-use.js keeps appending repos, and plan-complete.js reads the
// plan when the agent finishes planning. Deleting them here would destroy live
// state mid-session, so Codex leaves them to the reaper below.
if (isTerminal) {
  for (const p of [
    scratchPath('plan', sessionId, 'md'),
    scratchPath('plan-pending', sessionId, 'json'),
    scratchPath('repos', sessionId, 'json'),
    scratchPath('tokens', sessionId, 'json'),
    // Anything the pre-upgrade hooks left in /tmp for this session.
    legacyPath('plan', sessionId, 'md'),
    legacyPath('plan-pending', sessionId, 'json'),
    legacyPath('repos', sessionId, 'json'),
    legacyPath('tokens', sessionId, 'json'),
  ].filter(Boolean)) {
    try { fs.unlinkSync(p); } catch {}
  }
}

// Reaper for sessions whose end we never saw: a crashed host, a platform with
// no session-end event (Cursor), a plugin uninstalled mid-session, or a Codex
// session that only ever fires per-turn `Stop`. Anything older than a day
// cannot belong to a live session, and each name is keyed by a session id, so
// this only ever touches this plugin's own leftovers.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Also matches a `.<pid>.claim` left behind by a session-end run that died
// between claiming the counter file and deleting it.
const STALE = /^\.baz-(plan-pending|plan|counts|repos|tokens)-(.+?)\.(md|json)(\.\d+\.claim)?$/;
// `/tmp` is where versions of this plugin before the private scratch directory
// wrote everything; keep reaping it so their leftovers don't outlive the
// upgrade. Nothing is written there any more.
for (const dir of new Set([scratchDir(), '/tmp'].filter(Boolean))) {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(dir)) {
      const m = STALE.exec(name);
      if (!m) continue;
      // Never reap the session we are running inside. On Codex this script runs
      // on every turn, so a session that has been planning for more than a day
      // would otherwise reap its own live plan out from under itself.
      if (m[2] === sessionId) continue;
      const p = path.join(dir, name);
      try {
        if (now - fs.statSync(p).mtimeMs > MAX_AGE_MS) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
}

const logPath = scratchPath('counts', sessionId, 'json');

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
