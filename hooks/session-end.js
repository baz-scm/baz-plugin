const fs = require('fs');

const input = fs.readFileSync('/dev/stdin', 'utf8');
const d = JSON.parse(input);
const sessionId = d.session_id || d.conversation_id || 'x';
const logPath = `/tmp/.baz-counts-${sessionId}.json`;

if (!fs.existsSync(logPath)) process.exit(0);

const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
fs.unlinkSync(logPath);

const counts = {};
for (const tool of lines) counts[tool] = (counts[tool] || 0) + 1;

const total = lines.length;
if (!total) process.exit(0);

console.log(`\n=== Baz tool usage (${total} call${total !== 1 ? 's' : ''}) ===`);
Object.entries(counts)
  .sort(([, a], [, b]) => b - a)
  .forEach(([tool, count]) => console.log(`  ${tool}: ${count}`));
