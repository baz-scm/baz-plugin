const fs = require('fs');
const { execSync } = require('child_process');

// The HTTP MCP transport in Claude Code does not expand header value
// substitutions (e.g. `${CLAUDE_SESSION_ID}`), so the `x-session-id` header
// in the plugin manifest never reaches the MCP server. This hook works around
// that by surfacing both `sessionId` and the cwd's `owner/repo` to the
// assistant via additionalContext, and instructing it to pass them as tool
// arguments on every baz planning tool call.

const input = fs.readFileSync('/dev/stdin', 'utf8');
const d = JSON.parse(input);

// The per-platform hook manifest passes the vendor name as argv[2]
// (claude-code, codex, or cursor). Baz uses it to attribute planner sessions
// to the client that started them.
const SAFE_VENDOR = /^[A-Za-z0-9._-]{1,64}$/;
const vendorArg = process.argv[2] || '';
const agentVendor = SAFE_VENDOR.test(vendorArg) ? vendorArg : '';

const sessionId = d.session_id || '';
// Claude Code + Codex send `cwd` on the hook payload.
// Cursor sends `workspace_roots: [<path>, ...]` instead — use the first entry.
const cwd =
  d.cwd ||
  (Array.isArray(d.workspace_roots) && d.workspace_roots.length > 0
    ? d.workspace_roots[0]
    : '');

if (!sessionId) process.exit(0);

const SAFE_REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

let sessionRepo = '';
if (cwd) {
  try {
    const remote = execSync('git config --get remote.origin.url', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    if (remote) {
      const m = remote.match(/[:/]([^/:]+\/[^/:]+?)(?:\.git)?\/?$/);
      const candidate = m ? m[1] : '';
      if (SAFE_REPO.test(candidate)) sessionRepo = candidate;
    }
  } catch {
    // No git remote / not a git repo / git missing — fall through.
  }
}

let instruction = `Your agent session id is \`${sessionId}\`.`;
let args = `\`sessionId: "${sessionId}"\``;
if (sessionRepo) {
  instruction += ` You are running in repo \`${sessionRepo}\`.`;
  args += `, \`sessionRepository: "${sessionRepo}"\``;
}
if (agentVendor) {
  args += `, \`agentVendor: "${agentVendor}"\``;
}
instruction += ` When calling baz planning MCP tools (\`mcp__baz__repo_search\`, \`mcp__baz__remote_file_search\`, \`mcp__baz__remote_grep\`), always include ${args} as arguments. This is required for baz to correlate tool calls back to this session and the repo you are working in.`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: instruction,
  },
}));
