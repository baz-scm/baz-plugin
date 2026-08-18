const fs = require('fs');
const { failSoft, readHookInput, sessionIdOf, scratchPath } = require('./hook-io');

failSoft();

const d = readHookInput();
if (!d) process.exit(0);
const sessionId = sessionIdOf(d);
if (!sessionId) process.exit(0);

// Cursor has no session-end hook wired, so the counts summary never prints and
// the counter file would accumulate with no reaper. Skip the counts append on
// Cursor only: nothing would ever read it there.
//
// The repos append below still fires on every platform, because plan-complete.js
// reads it on Cursor too and the upload needs it. It used to be consumed by that
// read; it no longer is (see collectRepos), so on Cursor the repos and tokens
// files now accumulate the same way the counter file would have. Accepted under
// the "Cursor is best-effort" posture: both are a few hundred bytes, mode 0600
// inside a 0700 directory, and correct attribution on a revised plan is worth
// more than reaping a small file. Giving Cursor a reaper needs a lifecycle hook
// it actually runs.
const isCursor = !d.session_id && d.conversation_id;

if (!isCursor) {
  const toolName = (d.tool_name || '').split('__baz__')[1] || d.tool_name;
  const logPath = scratchPath('counts', sessionId, 'json');
  // Append-only: each call writes one line; avoids concurrent read/modify/write
  // race. Null means no private directory was established — write nothing.
  if (logPath) {
    try { fs.appendFileSync(logPath, toolName + '\n', { mode: 0o600 }); } catch {}
  }
}

// Also accumulate the set of repos touched by baz search tools during this
// planning session. plan-complete.js reads this file to populate `repoNames`
// on the final update_plan call so the plan is discoverable under each repo.
//
// Some hosts serialize `tool_input` as a JSON string rather than an object —
// same coercion as plan-complete.js so we don't silently drop repos on those.
function coerceToolInput(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

const toolInput = coerceToolInput(d.tool_input);
if (toolInput) {
  const repos = [];
  if (typeof toolInput.repository === 'string' && toolInput.repository) {
    repos.push(toolInput.repository);
  }
  if (
    typeof toolInput.sessionRepository === 'string' &&
    toolInput.sessionRepository
  ) {
    repos.push(toolInput.sessionRepository);
  }
  if (repos.length > 0) {
    const reposPath = scratchPath('repos', sessionId, 'json');
    if (reposPath) {
      try { fs.appendFileSync(reposPath, repos.join('\n') + '\n', { mode: 0o600 }); } catch {}
    }
  }
}
