const fs = require('fs');
const os = require('os');
const path = require('path');

// Shared stdin/robustness/scratch-path helpers for every hook in this plugin.
//
// Hooks run inside the user's session and the host surfaces a non-zero exit as
// a visible error ("Stop hook (failed) — error: hook exited with code 1").
// Nothing this plugin does at a session boundary — counting tool calls,
// printing a summary, parking a plan — is worth showing the user an error, so
// hooks fail soft: on anything unexpected they exit 0 and do nothing.
//
// The concrete trigger was Codex's `Stop` hook, which fires with no JSON body
// on some turns; `JSON.parse('')` threw and the whole session-end hook died.

// Install last-resort guards. Call this first, before any other work.
function failSoft() {
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
  // A host that closes the pipe before we finish writing would otherwise turn
  // a `console.log` into an EPIPE crash.
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});
}

// Read the hook payload from stdin. Returns null — meaning "no payload, do
// nothing" — when stdin is absent, empty, not JSON, or not an object. A host
// may hand the hook no stdin at all (closed fd, or a TTY, which throws EAGAIN),
// and Codex sends an empty body on some events; both are normal, not errors.
//
// fd 0 rather than '/dev/stdin': same stream, no dependency on /dev existing.
function readHookInput() {
  let raw;
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return null;
  }
  if (!raw || !raw.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  // `typeof [] === 'object'`, so arrays need their own check to reach the
  // documented no-op path rather than being handed to a hook as a payload.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed;
}

// --- Session id -------------------------------------------------------------

// Cursor payloads use `conversation_id`; Claude Code and Codex use `session_id`.
// Every scratch file this plugin writes is named after this value, so it is
// validated against an allowlist before it can reach a path: a host that handed
// us `../../etc/passwd` would otherwise have us unlink or rename outside our own
// directory. Returns '' when absent or not allowlisted, which every caller
// treats as "nothing to do".
const SAFE_SESSION = /^[A-Za-z0-9._-]{1,128}$/;

function sessionIdOf(payload) {
  const raw = (payload && (payload.session_id || payload.conversation_id)) || '';
  if (typeof raw !== 'string' || !SAFE_SESSION.test(raw)) return '';
  // Belt and braces: the allowlist already excludes separators, but a bare
  // '.' or '..' would pass it and still resolve to a directory.
  if (raw === '.' || raw === '..') return '';
  return raw;
}

// --- Scratch directory ------------------------------------------------------

// Everything this plugin writes — the plan, the parked payload, the counters —
// goes in a directory we own, mode 0700, rather than loose in a world-readable
// /tmp. The plan file is the reason: the *agent's* file-write tool creates it,
// so it lands with the agent's umask (0644 under the common 022), and the
// filename is derived from the session id rather than being secret. A private
// parent directory denies other local users regardless of the file's own mode.
//
// os.tmpdir() is already per-user on macOS (/var/folders/..., mode 700) and
// /tmp on Linux; the uid in the directory name keeps two users on one Linux box
// from colliding. If the directory can't be created we fall back to os.tmpdir()
// itself — degraded privacy, but the plugin keeps working.
let cachedDir = null;

function scratchDir() {
  if (cachedDir) return cachedDir;
  const base = os.tmpdir();
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  const dir = path.join(base, `.baz-${uid}`);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // mkdir is a no-op when the directory already exists, so an earlier version
    // of this plugin (or a umask) could have left it group/world readable.
    fs.chmodSync(dir, 0o700);
    cachedDir = dir;
  } catch {
    cachedDir = base;
  }
  return cachedDir;
}

// Absolute path of one scratch file, e.g. scratchPath('plan', sid, 'md').
function scratchPath(kind, sessionId, ext) {
  return path.join(scratchDir(), `.baz-${kind}-${sessionId}.${ext}`);
}

module.exports = { failSoft, readHookInput, sessionIdOf, scratchDir, scratchPath };
