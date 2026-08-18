const { failSoft, readHookInput, sessionIdOf, readScratchFile } = require('./hook-io');

failSoft();

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



function passThrough() {
  process.exit(0);
}

const d = readHookInput();
if (!d) passThrough();

const sessionId = sessionIdOf(d);
if (!sessionId) passThrough();

const toolInput =
  d.tool_input && typeof d.tool_input === 'object' ? d.tool_input : {};

if (typeof toolInput.content === 'string' && toolInput.content.trim()) passThrough();

// Private path first, then the pre-upgrade /tmp one: a plan parked by the old
// hooks before a live `/reload-plugins` must still reach the call, or the
// agent sends {} and the server rejects it.
const parked = readScratchFile('plan-pending', sessionId, 'json');
const payload = parked ? tryParseJson(parked.content) : null;
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
