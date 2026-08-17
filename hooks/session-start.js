const { execSync } = require('child_process');
const { failSoft, readHookInput } = require('./hook-io');

failSoft();

const d = readHookInput();
if (!d) process.exit(0);

const SAFE_VENDOR = /^[A-Za-z0-9._-]{1,64}$/;
const vendorArg = process.argv[2] || '';
const agentVendor = SAFE_VENDOR.test(vendorArg) ? vendorArg : '';

const sessionId = d.session_id || d.conversation_id || '';
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

// Codex and Cursor have no ExitPlanMode, so writing /tmp/.baz-plan-<sid>.md is
// the only "planning is over" signal plan-complete.js can match on. The
// plan-with-baz skill says so, but it's manual-invocation only — a user who
// plans without running the command would never write the file and the plugin
// would never offer to upload. This is platform plumbing, not planning advice,
// so the contract lives here rather than in the auto-loaded exploration skill.
//
// Cursor additionally drops `additionalContext` from non-MCP-tool postToolUse
// hooks, so the plan-complete prompt never reaches the model there — it has to
// raise the upload question itself. Either way the upload waits on the user's
// yes; nothing here authorizes the call.
if (agentVendor === 'codex' || agentVendor === 'cursor') {
  instruction +=
    ` COMPLETION CONTRACT: when you finish planning, write your final plan to` +
    ` \`/tmp/.baz-plan-${sessionId}.md\`. Writing that file is local and needs` +
    ` no permission, but it is what lets the baz plugin offer to persist the` +
    ` plan. Then ask the user which of three things to do next: (1) "Implement" —` +
    ` execute the plan now; (2) "Upload to Baz" — publish the plan to your` +
    ` organization's Baz timeline so teammates can read and comment on it;` +
    ` (3) "Change something" — free text for what they want different. Wait for` +
    ` their answer; none of the three is a default. Uploading is never automatic` +
    ` — only call \`mcp__baz__update_plan\` if they pick "Upload to Baz". If they` +
    ` pick anything else, skip the call; the planner session stays open in baz's` +
    ` timeline, which is the accepted cost.`;
}
if (agentVendor === 'cursor') {
  instruction +=
    ` (Cursor-specific: no automated follow-up prompt will arrive after the file` +
    ` write, so you must present those three choices yourself. If the user picks` +
    ` "Upload to Baz",` +
    ` call \`mcp__baz__update_plan\` with \`sessionId: "${sessionId}"\` and` +
    ` \`content\` set to the exact plan text you just wrote (verbatim, no` +
    ` summary), then show the user the plan link from the tool result.)`;
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: instruction,
  },
}));
