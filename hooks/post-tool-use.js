const fs = require('fs');

const input = fs.readFileSync('/dev/stdin', 'utf8');
const d = JSON.parse(input);
const sessionId = d.session_id || 'x';
const toolName = (d.tool_name || '').split('__baz__')[1] || d.tool_name;
const logPath = `/tmp/.baz-counts-${sessionId}.json`;

// Append-only: each call writes one line; avoids concurrent read/modify/write race
fs.appendFileSync(logPath, toolName + '\n');
