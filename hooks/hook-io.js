const fs = require('fs');

// Shared stdin/robustness helpers for every hook in this plugin.
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
  return parsed && typeof parsed === 'object' ? parsed : null;
}

module.exports = { failSoft, readHookInput };
