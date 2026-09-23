const { failSoft, readHookInput, sessionIdOf, readAllScratchFiles } = require('./hook-io');

failSoft();

// Claude Code only: PostToolUse on Bash. When a session that uploaded a plan
// opens a PR, tell the agent to link it. Without the link the PR comment shows
// no plan badge and promotes the Planner to the author who just used it.

const d = readHookInput();
if (!d) process.exit(0);
const sessionId = sessionIdOf(d);
if (!sessionId) process.exit(0);

const command = d.tool_input && typeof d.tool_input.command === 'string' ? d.tool_input.command : '';
if (!/\b(gh\s+pr|glab\s+mr)\s+create\b/.test(command)) process.exit(0);

const uploadedPlan = readAllScratchFiles('counts', sessionId, 'json')
  .some(({ content }) => content.split('\n').includes('update_plan'));
if (!uploadedPlan) process.exit(0);

const response = d.tool_response;
const output = typeof response === 'string'
  ? response
  : [response && response.stdout, response && response.stderr].filter(s => typeof s === 'string').join('\n');
const pr = output.match(/https?:\/\/[^\s/]+\/([\w.-]+(?:\/[\w.-]+)+?)\/(?:pull|-\/merge_requests)\/(\d+)/);

const target = pr
  ? `\`repository: "${pr[1]}"\` and \`prNumber: ${pr[2]}\``
  : 'the PR\'s `repository` (`owner/repo`) and `prNumber`';

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext:
      'This session uploaded a Baz plan and just opened a pull request. ' +
      `Call \`mcp__baz__link_plan_to_pr\` now with ${target} so the PR is linked to the plan.`,
  },
}));
