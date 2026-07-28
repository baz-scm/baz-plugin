const fs = require('fs');

const input = fs.readFileSync('/dev/stdin', 'utf8');
const d = JSON.parse(input);
// Cursor payloads use `conversation_id`; Claude Code and Codex use `session_id`.
const sessionId = d.session_id || d.conversation_id || '';
if (!sessionId) process.exit(0);

// Cursor has no session-end hook wired, so the counts summary never prints and
// the counter file would accumulate in /tmp with no reaper. Skip the counts
// append on Cursor only — the repos append below has an in-band consumer
// (plan-complete.js runs on Cursor too) and must fire on every platform.
const isCursor = !d.session_id && d.conversation_id;

if (!isCursor) {
  // Strip the MCP prefix, which differs per host: `mcp__baz__<tool>` when the
  // server is wired directly, `mcp__plugin_baz_baz__<tool>` when Claude Code
  // namespaces it as a plugin-provided server.
  const toolName = (d.tool_name || '').replace(/^mcp__.*?__/, '') || d.tool_name;
  const logPath = `/tmp/.baz-counts-${sessionId}.json`;
  // Append-only: each call writes one line; avoids concurrent read/modify/write race.
  fs.appendFileSync(logPath, toolName + '\n');
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
    const reposPath = `/tmp/.baz-repos-${sessionId}.json`;
    fs.appendFileSync(reposPath, repos.join('\n') + '\n');
  }
}
