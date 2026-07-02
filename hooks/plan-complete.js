const fs = require('fs');
const path = require('path');

// PostToolUse hook that emits the "call mcp__baz__complete_session next" nudge
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
const vendorArg = process.argv[2] || '';
const vendor = SAFE_VENDOR.test(vendorArg) ? vendorArg : '';

const input = fs.readFileSync('/dev/stdin', 'utf8');
let d;
try { d = JSON.parse(input); } catch { process.exit(0); }

const sessionId = d.session_id || d.conversation_id || '';
if (!sessionId) process.exit(0);

function basenameOf(p) {
  if (typeof p !== 'string') return '';
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function toolWritesPlanFile(hookInput, planFilename) {
  const raw = hookInput.tool_input;
  const input =
    raw && typeof raw === 'object'
      ? raw
      : typeof raw === 'string'
        ? (() => { try { return JSON.parse(raw); } catch { return null; } })()
        : null;
  if (!input || typeof input !== 'object') return false;

  // Well-known destination-path fields across CC / Cursor / others.
  const pathFields = ['file_path', 'path', 'target_file', 'notebook_path'];
  for (const key of pathFields) {
    if (basenameOf(input[key]) === planFilename) return true;
  }

  // Codex apply_patch: the destination lives inside a `command` envelope
  // like "*** Add File: <path>" / "*** Update File: <path>" / "*** Move to: <path>".
  if (typeof input.command === 'string') {
    const verbRe = /\*\*\* (?:Add|Update|Delete) File:\s*([^\n]+)/g;
    let m;
    while ((m = verbRe.exec(input.command)) !== null) {
      if (basenameOf(m[1].trim()) === planFilename) return true;
    }
    const moveRe = /\*\*\* Move to:\s*([^\n]+)/g;
    while ((m = moveRe.exec(input.command)) !== null) {
      if (basenameOf(m[1].trim()) === planFilename) return true;
    }
  }

  return false;
}

if ((d.tool_name || '') !== 'ExitPlanMode') {
  const planFilename = `.baz-plan-${sessionId}.md`;
  if (!toolWritesPlanFile(d, planFilename)) process.exit(0);
}

// --- Token extraction --------------------------------------------------------

function emptyUsage() {
  return {
    input_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    output_tokens: 0,
    api_call_count: 0,
  };
}

// Claude Code: transcript JSONL, per-message usage on assistant lines.
// Deduplicate by message.id (CC streams — same id appears multiple times as the
// message is generated; keep the entry with the highest output_tokens).
function extractClaudeCodeTokens(transcriptPath) {
  if (!transcriptPath) return null;
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch { return null; }
  const byMessage = new Map();
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'assistant') continue;
    const msg = obj.message;
    if (!msg || !msg.id || !msg.usage) continue;
    const existing = byMessage.get(msg.id);
    const out = Number(msg.usage.output_tokens) || 0;
    if (!existing || out > existing.output_tokens) {
      byMessage.set(msg.id, {
        input_tokens: Number(msg.usage.input_tokens) || 0,
        cache_creation_tokens: Number(msg.usage.cache_creation_input_tokens) || 0,
        cache_read_tokens: Number(msg.usage.cache_read_input_tokens) || 0,
        output_tokens: out,
      });
    }
  }
  if (byMessage.size === 0) return null;
  const total = emptyUsage();
  for (const u of byMessage.values()) {
    total.input_tokens += u.input_tokens;
    total.cache_creation_tokens += u.cache_creation_tokens;
    total.cache_read_tokens += u.cache_read_tokens;
    total.output_tokens += u.output_tokens;
  }
  total.api_call_count = byMessage.size;
  return total;
}

// Codex: rollout JSONL. Its `event_msg` lines with `type === 'token_count'`
// carry cumulative `total_token_usage`. Take the last one seen — that's the
// running total at the moment planning completed.
function extractCodexTokens(transcriptPath) {
  if (!transcriptPath) return null;
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch { return null; }
  let last = null;
  let apiCalls = 0;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'event_msg') continue;
    const evt = obj.payload;
    if (!evt || evt.type !== 'token_count') continue;
    apiCalls += 1;
    const info = evt.info;
    const usage = info && info.total_token_usage;
    if (usage) last = usage;
  }
  if (!last) return null;
  return {
    input_tokens: Number(last.input_tokens) || 0,
    cache_creation_tokens: 0,
    cache_read_tokens: Number(last.cached_input_tokens) || 0,
    output_tokens:
      (Number(last.output_tokens) || 0) +
      (Number(last.reasoning_output_tokens) || 0),
    api_call_count: apiCalls,
  };
}

function extractCursorTokens(sid) {
  const tallyPath = path.join('/tmp', `.baz-tokens-${sid}.json`);
  let raw;
  try { raw = fs.readFileSync(tallyPath, 'utf8'); } catch { return null; }
  try { fs.unlinkSync(tallyPath); } catch {}
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      typeof parsed.input_tokens === 'number' &&
      typeof parsed.output_tokens === 'number'
    ) {
      return {
        input_tokens: parsed.input_tokens,
        cache_creation_tokens: parsed.cache_creation_tokens || 0,
        cache_read_tokens: parsed.cache_read_tokens || 0,
        output_tokens: parsed.output_tokens,
        api_call_count: parsed.api_call_count || 0,
      };
    }
  } catch {}
  return null;
}

let tokens = null;
if (vendor === 'claude-code') {
  tokens = extractClaudeCodeTokens(d.transcript_path);
} else if (vendor === 'codex') {
  tokens = extractCodexTokens(d.transcript_path);
} else if (vendor === 'cursor') {
  tokens = extractCursorTokens(sessionId);
}

// --- Plan extraction ---------------------------------------------------------
// Read the plan text authoritatively from the source (tool_input for
// ExitPlanMode, plan file on disk otherwise), not from the model's memory. This
// removes the "did the model relay it verbatim?" risk and keeps the value
// deterministic.

const MAX_PLAN_LEN = 150000;
const TRUNCATION_MARKER = '\n\n[... truncated ...]';

function truncate(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  if (text.length <= MAX_PLAN_LEN) return text;
  return text.slice(0, MAX_PLAN_LEN - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

function coerceToolInput(raw) {
  // Some hosts pass tool_input as a JSON string; others as a parsed object.
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

function extractPlan(hookInput, sid) {
  if ((hookInput.tool_name || '') === 'ExitPlanMode') {
    // Claude Code emits ExitPlanMode's plan on `tool_response.plan`, not
    // `tool_input.plan`. `tool_input` is empty. Fall back to `tool_input.plan`
    // in case a fork or future version puts it there instead.
    const response = coerceToolInput(hookInput.tool_response);
    const input = coerceToolInput(hookInput.tool_input);
    const plan =
      (response && typeof response.plan === 'string' && response.plan) ||
      (input && typeof input.plan === 'string' && input.plan) ||
      null;
    return truncate(plan);
  }
  const planPath = path.join('/tmp', `.baz-plan-${sid}.md`);
  try {
    return truncate(fs.readFileSync(planPath, 'utf8'));
  } catch {
    return null;
  }
}

const finalPlan = extractPlan(d, sessionId);

// --- Emit the completion instruction ----------------------------------------

const completedAt = new Date().toISOString();

let instruction =
  `REQUIRED — DO THIS NOW: You just finished planning. ` +
  `Your next tool invocation MUST be \`mcp__baz__complete_session\` with ` +
  `\`sessionId: "${sessionId}"\` and \`completedAt: "${completedAt}"\`.`;

if (finalPlan !== null) {
  instruction +=
    ` Also pass \`finalPlan: ${JSON.stringify(finalPlan)}\` — this is the ` +
    `authoritative plan text (read from the tool input or the plan file on disk); ` +
    `pass the string exactly as given.`;
}

if (tokens) {
  instruction +=
    ` Also pass \`tokensUsed: ${JSON.stringify(tokens)}\` — this is the ` +
    `authoritative token count for this session, computed from the host ` +
    `transcript. Pass the object exactly as given.`;
}

instruction +=
  ` This is the signal baz uses to close the planning session in its timeline. ` +
  `Call it exactly once, before responding to the user or running any other tool.`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext: instruction,
  },
}));
