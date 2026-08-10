const fs = require('fs');
const path = require('path');

// PreToolUse on mcp__baz__update_plan. The agent calls it with no arguments;
// this fills in the session id from the hook's stdin payload and the plan text
// plan-complete.js parked under it, so the plan is generated once instead of
// being re-typed into the call.
//
// Only ever adds what is missing — a call that already carries `content`
// (Codex/Cursor, older plugin) passes through untouched, as does one with
// nothing parked, which the server rejects with a retry hint.

function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function safeReadFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; }
}

// Keep in sync with plan-complete.js.
function pendingPayloadPath(sid) {
  return path.join('/tmp', `.baz-plan-pending-${sid}.json`);
}

const SAFE_SESSION = /^[A-Za-z0-9-]{1,128}$/;

function passThrough() {
  process.exit(0);
}

const d = tryParseJson(fs.readFileSync('/dev/stdin', 'utf8'));
if (!d) passThrough();

const sessionId = d.session_id || d.conversation_id || '';
if (!sessionId || !SAFE_SESSION.test(sessionId)) passThrough();

const toolInput =
  d.tool_input && typeof d.tool_input === 'object' ? d.tool_input : {};

if (typeof toolInput.content === 'string' && toolInput.content.trim()) passThrough();

const payload = tryParseJson(safeReadFile(pendingPayloadPath(sessionId)));
if (!payload || typeof payload.content !== 'string' || !payload.content.trim()) {
  passThrough();
}

// sessionId from the hook input wins: it keys the parked plan, whatever the
// agent typed.
const updatedInput = { ...toolInput, sessionId, content: payload.content };
if (payload.tokensUsed) updatedInput.tokensUsed = payload.tokensUsed;
if (payload.modelId) updatedInput.modelId = payload.modelId;
if (payload.agentVendor) updatedInput.agentVendor = payload.agentVendor;
if (Array.isArray(payload.repoNames) && payload.repoNames.length > 0) {
  updatedInput.repoNames = payload.repoNames;
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    updatedInput,
  },
}));
