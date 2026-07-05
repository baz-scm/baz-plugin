const fs = require('fs');

const input = fs.readFileSync('/dev/stdin', 'utf8');
const d = JSON.parse(input);
// Cursor payloads use `conversation_id`; Claude Code and Codex use `session_id`.
const sessionId = d.session_id || d.conversation_id || '';
if (!sessionId) process.exit(0);

// Cursor has no session-end hook we can rely on for cleanup, so skip the
// per-tool counter entirely on Cursor — otherwise the counter file would
// accumulate in /tmp with no reaper. On Cursor the "===Baz tool usage==="
// summary printed by session-end.js was never reaching the user anyway
// (session-end.js was not firing). Payloads with `conversation_id` but no
// `session_id` are Cursor.
if (!d.session_id && d.conversation_id) process.exit(0);

const toolName = (d.tool_name || '').split('__baz__')[1] || d.tool_name;
const logPath = `/tmp/.baz-counts-${sessionId}.json`;

// Append-only: each call writes one line; avoids concurrent read/modify/write race
fs.appendFileSync(logPath, toolName + '\n');
