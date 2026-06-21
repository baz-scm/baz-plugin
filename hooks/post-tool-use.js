const fs = require('fs');

const input = fs.readFileSync('/dev/stdin', 'utf8');
const d = JSON.parse(input);
const sessionId = d.session_id || 'x';
const toolName = (d.tool_name || '').split('__baz__')[1] || d.tool_name;
const counterPath = `/tmp/.baz-counts-${sessionId}.json`;

const counts = fs.existsSync(counterPath)
  ? JSON.parse(fs.readFileSync(counterPath, 'utf8'))
  : {};

counts[toolName] = (counts[toolName] || 0) + 1;
fs.writeFileSync(counterPath, JSON.stringify(counts));
