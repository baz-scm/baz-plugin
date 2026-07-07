const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// PostToolUse hook that emits the "call mcp__baz__update_plan next" nudge
// once planning is done. Two trigger paths converge here:
//
//   1. CC's ExitPlanMode — agent used plan mode (which blocks file writes, so
//      path 2 can't fire). Always nudge on this tool.
//   2. File-write tools (Write/Edit/apply_patch/edit_file/write_file) — agent
//      planned inline and wrote its final plan to /tmp/.baz-plan-<sessionId>.md
//      per SKILL.md / .cursor/rules / AGENTS.md.
//
// For path 2 we inspect the tool's *destination path* fields (not the full
// tool_input JSON) so a Write/Edit whose *content* happens to mention the
// plan filename doesn't spuriously trigger completion. Each platform uses a
// different field: CC Write/Edit uses `file_path`, Cursor edit_file/write_file
// uses `path` or `target_file`, Codex apply_patch encodes the path in a
// `command` envelope (e.g. "*** Add File: <path>"). We match by basename
// because macOS resolves /tmp → /private/tmp before the path reaches the hook.
//
// argv[2] is the vendor name ('claude-code' | 'codex' | 'cursor'); the
// per-platform hook manifest passes it so we can dispatch token extraction.

const SAFE_VENDOR = /^[A-Za-z0-9._-]{1,64}$/;
const SAFE_REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

const vendorArg = process.argv[2] || '';
const vendor = SAFE_VENDOR.test(vendorArg) ? vendorArg : '';

// --- Pure helpers -----------------------------------------------------------

function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function safeReadFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; }
}

function safeUnlink(filePath) {
  try { fs.unlinkSync(filePath); } catch {}
}

function readJsonlObjects(filePath) {
  const raw = safeReadFile(filePath);
  if (raw === null) return [];
  return raw.split('\n')
    .filter(Boolean)
    .map(tryParseJson)
    .filter(obj => obj !== null);
}

function basenameOf(p) {
  if (typeof p !== 'string') return '';
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function coerceToolInput(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') return tryParseJson(raw);
  return null;
}

function normalizePlan(text) {
  return typeof text === 'string' && text.length > 0 ? text : null;
}

// --- Trigger detection ------------------------------------------------------

function toolWritesPlanFile(hookInput, planFilename) {
  const input = coerceToolInput(hookInput.tool_input);
  if (!input) return false;

  const directPaths = ['file_path', 'path', 'target_file', 'notebook_path']
    .map(k => input[k]);
  if (directPaths.some(p => basenameOf(p) === planFilename)) return true;

  // Codex apply_patch: destination lives in a `command` envelope like
  // "*** Add File: <path>" / "*** Update File: <path>" / "*** Move to: <path>".
  if (typeof input.command === 'string') {
    const re = /\*\*\* (?:(?:Add|Update|Delete) File|Move to):\s*([^\n]+)/g;
    for (const m of input.command.matchAll(re)) {
      if (basenameOf(m[1].trim()) === planFilename) return true;
    }
  }

  return false;
}

// --- Usage extractors -------------------------------------------------------
// Each returns { tokens, modelId } or null. Either field may be null on its
// own if only one signal is available.

// Claude Code: transcript JSONL, per-message usage on assistant lines.
// Deduplicate by message.id (CC streams — same id appears multiple times as
// the message is generated; keep the entry with the highest output_tokens).
// Input tokens include cache reads/creation. modelId is the last non-empty
// `message.model` seen (the model at the moment planning completed).
function extractClaudeCodeUsage(transcriptPath) {
  if (!transcriptPath) return null;
  const byMessage = new Map();
  let modelId = null;
  for (const obj of readJsonlObjects(transcriptPath)) {
    if (obj.type !== 'assistant') continue;
    const msg = obj.message;
    if (!msg) continue;
    if (typeof msg.model === 'string' && msg.model) modelId = msg.model;
    if (!msg.id || !msg.usage) continue;
    const out = Number(msg.usage.output_tokens) || 0;
    const existing = byMessage.get(msg.id);
    if (existing && existing.output_tokens >= out) continue;
    const inTok =
      (Number(msg.usage.input_tokens) || 0) +
      (Number(msg.usage.cache_creation_input_tokens) || 0) +
      (Number(msg.usage.cache_read_input_tokens) || 0);
    byMessage.set(msg.id, { input_tokens: inTok, output_tokens: out });
  }
  if (byMessage.size === 0 && !modelId) return null;
  let input_tokens = 0, output_tokens = 0;
  for (const u of byMessage.values()) {
    input_tokens += u.input_tokens;
    output_tokens += u.output_tokens;
  }
  const tokens = byMessage.size > 0 ? { input_tokens, output_tokens } : null;
  return { tokens, modelId };
}

// Codex: rollout JSONL. `event_msg` lines with `type === 'token_count'` carry
// cumulative `total_token_usage`; last one wins. Model id can appear on
// `evt.model` (any event) or on `evt.info.model` (token_count events).
function extractCodexUsage(transcriptPath) {
  if (!transcriptPath) return null;
  let last = null;
  let modelId = null;
  for (const obj of readJsonlObjects(transcriptPath)) {
    if (obj.type !== 'event_msg') continue;
    const evt = obj.payload;
    if (!evt) continue;
    if (typeof evt.model === 'string' && evt.model) modelId = evt.model;
    if (evt.type !== 'token_count') continue;
    const info = evt.info;
    const usage = info && info.total_token_usage;
    if (usage) last = usage;
    if (info && typeof info.model === 'string' && info.model) modelId = info.model;
  }
  const tokens = last ? {
    input_tokens:
      (Number(last.input_tokens) || 0) +
      (Number(last.cached_input_tokens) || 0),
    output_tokens:
      (Number(last.output_tokens) || 0) +
      (Number(last.reasoning_output_tokens) || 0),
  } : null;
  if (!tokens && !modelId) return null;
  return { tokens, modelId };
}

// Cursor: per-turn tally accumulated by stop-token-tally.js in /tmp. Both
// tokens and model id come from Cursor's stop hook payload (model_id preferred
// over the display-name `model`); the tally file is last-write-wins for model
// id across turns.
function extractCursorUsage(sid) {
  const tallyPath = path.join('/tmp', `.baz-tokens-${sid}.json`);
  const raw = safeReadFile(tallyPath);
  if (raw === null) return null;
  safeUnlink(tallyPath);
  const parsed = tryParseJson(raw);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.input_tokens !== 'number' ||
    typeof parsed.output_tokens !== 'number'
  ) return null;
  const modelId = typeof parsed.model_id === 'string' && parsed.model_id
    ? parsed.model_id
    : null;
  return {
    tokens: { input_tokens: parsed.input_tokens, output_tokens: parsed.output_tokens },
    modelId,
  };
}

// --- Plan extraction --------------------------------------------------------
// Read the plan text authoritatively from the source (tool_input for
// ExitPlanMode, plan file on disk otherwise), not from the model's memory.
// This removes the "did the model relay it verbatim?" risk and keeps the
// value deterministic.

function extractPlan(hookInput, sid) {
  if ((hookInput.tool_name || '') === 'ExitPlanMode') {
    // CC emits ExitPlanMode's plan on `tool_response.plan`, not
    // `tool_input.plan`. Fall back to `tool_input.plan` in case a fork or
    // future version puts it there instead.
    const response = coerceToolInput(hookInput.tool_response);
    const input = coerceToolInput(hookInput.tool_input);
    const plan =
      (response && typeof response.plan === 'string' && response.plan) ||
      (input && typeof input.plan === 'string' && input.plan) ||
      null;
    return normalizePlan(plan);
  }
  const planPath = path.join('/tmp', `.baz-plan-${sid}.md`);
  const content = safeReadFile(planPath);
  if (content === null) return null;
  safeUnlink(planPath);
  return normalizePlan(content);
}

// --- Repos related to the plan ----------------------------------------------
// post-tool-use.js accumulates the `repository` / `sessionRepository` argument
// from every baz MCP tool call into /tmp/.baz-repos-<sessionId>.json. We also
// derive the session's own repo from cwd so the plan is always attributed to
// where the user is actually working.

function repoFromCwd(cwd) {
  if (!cwd) return null;
  let remote;
  try {
    remote = execSync('git config --get remote.origin.url', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
  const m = remote.match(/[:/]([^/:]+\/[^/:]+?)(?:\.git)?\/?$/);
  return m && SAFE_REPO.test(m[1]) ? m[1] : null;
}

function collectRepos(sid, cwd) {
  const seen = new Set();
  const cwdRepo = repoFromCwd(cwd);
  if (cwdRepo) seen.add(cwdRepo);

  const reposPath = path.join('/tmp', `.baz-repos-${sid}.json`);
  const raw = safeReadFile(reposPath);
  if (raw !== null) {
    safeUnlink(reposPath);
    for (const line of raw.split('\n')) {
      const name = line.trim();
      if (name) seen.add(name);
    }
  }
  return [...seen];
}

function cwdFromHookInput(hookInput) {
  if (hookInput.cwd) return hookInput.cwd;
  if (Array.isArray(hookInput.workspace_roots) && hookInput.workspace_roots.length > 0) {
    return hookInput.workspace_roots[0];
  }
  return '';
}

// --- Main flow --------------------------------------------------------------

const d = tryParseJson(fs.readFileSync('/dev/stdin', 'utf8'));
if (!d) process.exit(0);

const sessionId = d.session_id || d.conversation_id || '';
if (!sessionId) process.exit(0);

if ((d.tool_name || '') !== 'ExitPlanMode') {
  if (!toolWritesPlanFile(d, `.baz-plan-${sessionId}.md`)) process.exit(0);
}

// update_plan requires content — if we couldn't extract the plan, there's
// nothing to persist and no viable tool call to nudge. Exit quietly rather
// than firing a broken instruction; the session stays open in baz's timeline
// until a later hook supplies a plan.
const planContent = extractPlan(d, sessionId);
if (planContent === null) process.exit(0);

const usage =
  vendor === 'claude-code' ? extractClaudeCodeUsage(d.transcript_path) :
  vendor === 'codex'       ? extractCodexUsage(d.transcript_path) :
  vendor === 'cursor'      ? extractCursorUsage(sessionId) :
  null;
const tokens = usage && usage.tokens;
const modelId = usage && usage.modelId;

const repoNames = collectRepos(sessionId, cwdFromHookInput(d));

const completedAt = new Date().toISOString();
const instruction = [
  `REQUIRED — DO THIS NOW: You just finished planning.` +
    ` Your next tool invocation MUST be \`mcp__baz__update_plan\` with` +
    ` \`sessionId: "${sessionId}"\`, \`completedAt: "${completedAt}"\`, and` +
    ` \`content: ${JSON.stringify(planContent)}\` — this is the authoritative` +
    ` plan text (read from the tool input or the plan file on disk); pass the` +
    ` string exactly as given.`,
  tokens &&
    `Also pass \`tokensUsed: ${JSON.stringify(tokens)}\` — this is the` +
    ` authoritative token count for this session, computed from the host` +
    ` transcript. Pass the object exactly as given.`,
  modelId &&
    `Also pass \`modelId: ${JSON.stringify(modelId)}\` — this is the model id` +
    ` read from the host transcript for this session. Pass the string exactly` +
    ` as given.`,
  repoNames.length > 0 &&
    `Also pass \`repoNames: ${JSON.stringify(repoNames)}\` — this is the set of` +
    ` repositories relevant to this plan (the session's root repo plus every` +
    ` repo searched via baz MCP tools). Pass the array exactly as given so the` +
    ` plan is discoverable under each of these repos.`,
  `\`completedAt\` is what tells baz to persist this as the final plan and` +
    ` close the planner session on the timeline. Call it exactly once, before` +
    ` responding to the user or running any other tool.`,
].filter(Boolean).join(' ');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext: instruction,
  },
}));
