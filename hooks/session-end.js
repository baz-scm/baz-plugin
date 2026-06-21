const fs = require('fs');

const input = fs.readFileSync('/dev/stdin', 'utf8');
const d = JSON.parse(input);
const sessionId = d.session_id || 'x';
const counterPath = `/tmp/.baz-counts-${sessionId}.json`;

if (!fs.existsSync(counterPath)) process.exit(0);

const counts = JSON.parse(fs.readFileSync(counterPath, 'utf8'));
fs.unlinkSync(counterPath);

const total = Object.values(counts).reduce((a, b) => a + b, 0);
if (!total) process.exit(0);

console.log(`\n=== Baz tool usage (${total} call${total !== 1 ? 's' : ''}) ===`);
Object.entries(counts)
  .sort(([, a], [, b]) => b - a)
  .forEach(([tool, count]) => console.log(`  ${tool}: ${count}`));
