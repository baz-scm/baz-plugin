const fs = require('fs');
const { failSoft, readHookInput, sessionIdOf, scratchPath } = require('./hook-io');

failSoft();

const d = readHookInput();
if (!d) process.exit(0);
const sessionId = sessionIdOf(d);
if (!sessionId) process.exit(0);

// Cursor has no session-end hook wired, so nothing would ever read the counter
// file there. The repos append below still fires everywhere, because
// plan-complete.js reads it on Cursor and the upload needs it — it accumulates
// unreaped there, which CLAUDE.md accepts under "Cursor is best-effort".
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

// The file is one name per line, so a value carrying a newline would split into
// two names downstream and attribute the plan to a repo nobody searched.
const isOneLine = v => typeof v === 'string' && v !== '' && !/[\r\n]/.test(v);

const toolInput = coerceToolInput(d.tool_input);
if (toolInput) {
  const repos = [toolInput.repository, toolInput.sessionRepository].filter(isOneLine);
  if (repos.length > 0) {
    const reposPath = scratchPath('repos', sessionId, 'json');
    if (reposPath) {
      try { fs.appendFileSync(reposPath, repos.join('\n') + '\n', { mode: 0o600 }); } catch {}
    }
  }
}
