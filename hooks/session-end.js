const fs = require('fs');
const { failSoft, readHookInput } = require('./hook-io');

failSoft();

const d = readHookInput();
if (!d) process.exit(0);

const sessionId = d.session_id || d.conversation_id || '';
if (!sessionId) process.exit(0);

try { fs.unlinkSync(`/tmp/.baz-plan-pending-${sessionId}.json`); } catch {}

const logPath = `/tmp/.baz-counts-${sessionId}.json`;

// Read-then-delete, both guarded: on Codex this hook runs on every `Stop`, so
// two turns ending close together can race for the same file.
let raw;
try {
  raw = fs.readFileSync(logPath, 'utf8');
} catch {
  process.exit(0);
}
try { fs.unlinkSync(logPath); } catch {}

const lines = raw.split('\n').filter(Boolean);

const counts = {};
for (const tool of lines) counts[tool] = (counts[tool] || 0) + 1;

const total = lines.length;
if (!total) process.exit(0);

console.log(`\n=== Baz tool usage (${total} call${total !== 1 ? 's' : ''}) ===`);
Object.entries(counts)
  .sort(([, a], [, b]) => b - a)
  .forEach(([tool, count]) => console.log(`  ${tool}: ${count}`));
