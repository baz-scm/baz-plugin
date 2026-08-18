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

function isSafeSessionId(raw) {
  if (typeof raw !== 'string' || !SAFE_SESSION.test(raw)) return false;
  // Belt and braces: the allowlist already excludes separators, but a bare
  // '.' or '..' would pass it and still resolve to a directory.
  return raw !== '.' && raw !== '..';
}

// Each candidate is validated on its own rather than picking the first truthy
// one: a payload carrying a malformed `session_id` alongside a valid
// `conversation_id` would otherwise resolve to '' and silently switch this
// session's plan handling off.
function sessionIdOf(payload) {
  if (!payload) return '';
  for (const raw of [payload.session_id, payload.conversation_id]) {
    if (isSafeSessionId(raw)) return raw;
  }
  return '';
}

// --- Scratch directory ------------------------------------------------------

// Everything this plugin writes — the plan, the parked payload, the counters —
// goes in a directory we own, mode 0700, never loose in a shared /tmp. The plan
// file is the reason: the *agent's* file-write tool creates it, so it lands with
// the agent's umask (0644 under the common 022), and the filename is derived
// from the session id rather than being secret. We cannot set the mode on a file
// we do not write, so the parent directory is what denies other local accounts.
//
// This **fails closed**. If no directory can be established and verified
// private, scratchDir() returns null and every caller does nothing, rather than
// falling back to the shared directory the private one exists to avoid: on a
// multi-user Linux box another account can pre-create /tmp/.baz-<our uid> (as a
// directory it owns, or a symlink pointing somewhere it can read) and a
// fallback would hand it the plan.
//
// Candidates are tried in a fixed order so that every hook process in a session
// independently resolves the same directory: os.tmpdir() first (already
// per-user on macOS; the uid in the name separates users on Linux), then a
// directory under $HOME for hosts where the temp directory is unusable.
function candidateDirs() {
  const dirs = [];
  const home = (typeof os.homedir === 'function' && os.homedir()) || process.env.HOME || '';
  if (typeof process.getuid === 'function') {
    // POSIX: os.tmpdir() plus our uid, verified below by owner and mode.
    try { dirs.push(path.join(os.tmpdir(), `.baz-${process.getuid()}`)); } catch {}
    if (home) dirs.push(path.join(home, '.baz', 'scratch'));
  } else if (home) {
    // No getuid (Windows): we cannot name a directory per-user from a uid, and
    // chmod 0700 does not restrict another account there — POSIX mode bits are
    // not what isolates a Windows path, its ACL is, and we do not read ACLs.
    // A shared TEMP root would therefore be accepted while being readable by
    // other accounts, so only the per-user home directory is a candidate; it
    // is ACL-restricted to its owner by default. If that is unavailable we
    // resolve to null and the plan-file features stay off.
    dirs.push(path.join(home, '.baz', 'scratch'));
  }
  return dirs;
}

// True only for a real directory, not a symlink, owned by us, with no group or
// other permission bits. lstat rather than stat: stat would follow a symlink
// planted by another account and report the target's properties.
function isPrivateDir(dir) {
  let st;
  try { st = fs.lstatSync(dir); } catch { return false; }
  if (!st.isDirectory()) return false;
  if (typeof process.getuid !== 'function') {
    // Non-POSIX: no owner check and no meaningful mode bits. We only get here
    // for a path under the user's own home directory (see candidateDirs).
    return true;
  }
  if (st.uid !== process.getuid()) return false;
  if ((st.mode & 0o077) !== 0) {
    // Ours but too permissive (an older version of this plugin, or a umask).
    try { fs.chmodSync(dir, 0o700); } catch { return false; }
    try { st = fs.lstatSync(dir); } catch { return false; }
    if ((st.mode & 0o077) !== 0) return false;
  }
  return true;
}

// undefined = not resolved yet, null = resolved to "unavailable".
let cachedDir;

function scratchDir() {
  if (cachedDir !== undefined) return cachedDir;
  for (const dir of candidateDirs()) {
    // mkdir first (no-op when it already exists), then verify what is actually
    // there — an existing entry is never trusted on the strength of mkdir alone.
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch {}
    if (isPrivateDir(dir)) {
      cachedDir = dir;
      return cachedDir;
    }
  }
  cachedDir = null;
  return cachedDir;
}

// Absolute path of one scratch file, e.g. scratchPath('plan', sid, 'md').
// null when no private directory is available; callers treat that as
// "this feature is off for this session".
function scratchPath(kind, sessionId, ext) {
  const dir = scratchDir();
  return dir ? path.join(dir, `.baz-${kind}-${sessionId}.${ext}`) : null;
}

// Where versions of this plugin before the private directory wrote everything.
// Read-only compatibility: a session that was already running when the plugin
// was upgraded (a live `/reload-plugins`) has its plan, repo list, token tally
// and parked payload sitting here, written by the old hooks. Readers fall back
// to it and consume it; nothing writes here any more, and the reaper in
// session-end.js clears what is left behind.
function legacyPath(kind, sessionId, ext) {
  return path.join('/tmp', `.baz-${kind}-${sessionId}.${ext}`);
}

// Every location this file could be in, private first. Callers that want to
// merge both (counters, repo lists, token tallies) iterate; callers that want
// one winner take the first that validates.
function scratchCandidates(kind, sessionId, ext) {
  return [scratchPath(kind, sessionId, ext), legacyPath(kind, sessionId, ext)]
    .filter(Boolean);
}

// Read the first location whose content passes `isValid`, private before
// legacy. Returns { path, content } or null; the caller decides whether to
// unlink. The validator matters during an upgrade: an empty or truncated
// private file must not shadow a good pre-upgrade one, or the plan silently
// becomes unrecoverable. Default: any non-empty content.
function readScratchFile(kind, sessionId, ext, isValid) {
  const ok = typeof isValid === 'function'
    ? isValid
    : (content) => typeof content === 'string' && content.length > 0;
  for (const p of scratchCandidates(kind, sessionId, ext)) {
    let content;
    try {
      content = fs.readFileSync(p, 'utf8');
    } catch { continue; }
    if (ok(content)) return { path: p, content };
  }
  return null;
}

// Read *every* location that has this file, for callers that accumulate rather
// than choose. Returns [{ path, content }] in private-then-legacy order.
function readAllScratchFiles(kind, sessionId, ext) {
  const found = [];
  for (const p of scratchCandidates(kind, sessionId, ext)) {
    try {
      found.push({ path: p, content: fs.readFileSync(p, 'utf8') });
    } catch {}
  }
  return found;
}

// A path is emitted into a Markdown code span in the agent's context. A root
// taken from TMPDIR/HOME could carry a backtick or a newline and break out of
// that span into model-facing text, so a path that cannot be rendered safely is
// not emitted at all.
function isRenderablePath(p) {
  return typeof p === 'string' && p.length > 0 && !/[`\r\n\u0000-\u001f]/.test(p);
}

module.exports = {
  failSoft,
  readHookInput,
  sessionIdOf,
  scratchDir,
  scratchPath,
  legacyPath,
  readScratchFile,
  readAllScratchFiles,
  isRenderablePath,
};
