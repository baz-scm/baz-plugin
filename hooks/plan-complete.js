const fs = require('fs');

// PostToolUse hook that emits the "call mcp__baz__complete_session next" nudge
// once planning is done. Two trigger paths converge here:
//
//   1. CC's ExitPlanMode — agent used plan mode (which blocks file writes, so
//      path 2 can't fire). Always nudge on this tool.
//   2. File-write tools (Write/Edit/apply_patch/edit_file/write_file) — agent
//      planned inline and wrote its final plan to /tmp/.baz-plan-<sessionId>.md
//      per SKILL.md / .cursor/rules / AGENTS.md. Filter by filename so unrelated
//      writes don't fire.
//
// File-path match is done against the stringified tool input — each platform
// names the path field differently (file_path / path / apply_patch arg blob).
// We match by filename only because macOS resolves /tmp to /private/tmp before
// the path reaches the hook.

const input = fs.readFileSync('/dev/stdin', 'utf8');
let d;
try { d = JSON.parse(input); } catch { process.exit(0); }

const sessionId = d.session_id || '';
if (!sessionId) process.exit(0);

if ((d.tool_name || '') !== 'ExitPlanMode') {
  const planFilename = `.baz-plan-${sessionId}.md`;
  const haystack = JSON.stringify(d.tool_input || d);
  if (!haystack.includes(planFilename)) process.exit(0);
}

const completedAt = new Date().toISOString();
const instruction =
  `REQUIRED — DO THIS NOW: You just finished planning. ` +
  `Your next tool invocation MUST be \`mcp__baz__complete_session\` with ` +
  `\`sessionId: "${sessionId}"\` and \`completedAt: "${completedAt}"\`. ` +
  `This is the signal baz uses to close the planning session in its timeline. ` +
  `Call it exactly once, before responding to the user or running any other tool.`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext: instruction,
  },
}));
