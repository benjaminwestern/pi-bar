/**
 * VENDORED COPY of pure progress-update logic from `extensions/status-footer.ts`.
 *
 * This is a backtest harness, not shipped with the extension. Keep in sync
 * manually when status-footer.ts changes. The intent is to replay past pi
 * sessions through identical fact-collection + prompt-construction logic
 * without pulling in pi-tui/pi-ai/pi-coding-agent peer dependencies.
 *
 * What is intentionally NOT vendored:
 *  - FooterProgressEngine timing/abort plumbing (we re-implement a simulated
 *    scheduler in run.ts using event timestamps).
 *  - getFastProgressModelAuth (live model auth is done via fetch in run.ts).
 */

export const MAX_ACTIVITY_TEXT_CHARS = 800;
export const MAX_USER_TEXT_CHARS = 700;
export const MAX_ASSISTANT_UPDATE_CHARS = 500;
export const MAX_TOOL_RESULT_OK_CHARS = 160;
export const MAX_TOOL_RESULT_ERROR_CHARS = 320;
export const MAX_FINAL_TEXT_CHARS = 700;
export const MAX_RETAINED_RAW_ACTIVITIES = 128;
export const MAX_CONTEXT_CHECKPOINTS = 8;
export const PROGRESS_TARGET_SUMMARY_CHARS = 60;
export const MAX_SAFE_PROGRESS_CHARS = 240;
export const PROGRESS_DISPLAY_UPDATE_INTERVAL_MS = 1_200;
export const NORMAL_CHECKPOINT_QUIET_MS = 1_500;
export const NORMAL_CHECKPOINT_MAX_WAIT_MS = 2_500;

const ANSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;

export type ProgressActivityType =
	| "user_message"
	| "assistant_update"
	| "tool_call"
	| "tool_result"
	| "assistant_final"
	| "assistant_failure";
export type ProgressDisplayPriority = "immediate" | "normal" | "final";
export type ProgressActivity = {
	index: number;
	activityType: ProgressActivityType;
	displayPriority: ProgressDisplayPriority;
	text: string;
	toolCallId?: string;
};
export type ProgressCheckpoint = {
	activityIndex: number;
	displayPriority: ProgressDisplayPriority;
	text: string;
};

export function truncateText(text: string, maxChars: number): string {
	if (maxChars <= 0) return "";
	const chars = Array.from(text);
	if (chars.length <= maxChars) return text;
	if (maxChars === 1) return "…";
	const retainedChars = maxChars - 1;
	const headLength = Math.ceil(retainedChars / 2);
	const tailLength = Math.floor(retainedChars / 2);
	const head = chars.slice(0, headLength).join("");
	const tail = tailLength > 0 ? chars.slice(-tailLength).join("") : "";
	return `${head}…${tail}`;
}

export function tailText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `…${text.slice(-(maxChars - 1))}`;
}

export function compactText(text: string): string {
	return text.replace(ANSI_PATTERN, "").replace(/\s+/g, " ").trim();
}

function compactValue(value: unknown, maxChars: number): string | undefined {
	if (value === undefined || value === null) return undefined;
	let text: string;
	if (typeof value === "string") text = value;
	else {
		try {
			text = JSON.stringify(value);
		} catch {
			text = String(value);
		}
	}
	return text ? truncateText(compactText(text), maxChars) : undefined;
}

function compactInputArgs(input: Record<string, unknown>, maxChars: number): string | undefined {
	const args = Object.entries(input)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => {
			const formatted = compactValue(value, 80);
			return formatted ? `${key}=${formatted}` : undefined;
		})
		.filter((arg): arg is string => Boolean(arg));
	let result = "";
	for (const arg of args) {
		const next = result ? `${result} ${arg}` : arg;
		if (next.length > maxChars) break;
		result = next;
	}
	return result || undefined;
}

export function compactToolInput(toolName: string, input: Record<string, unknown> | undefined): string {
	if (!input) return toolName;
	const path = compactValue(input.path ?? input.filePath ?? input.cwd, 120);
	const command = compactValue(input.command, 180);
	const pattern = compactValue(input.pattern ?? input.query, 120);
	const include = compactValue(input.include ?? input.glob, 80);
	switch (toolName) {
		case "bash":
			return command ? `bash ${command}` : "bash";
		case "read":
			return path ? `read ${path}` : "read";
		case "edit":
			return path ? `edit ${path}` : "edit";
		case "write":
			return path ? `write ${path}` : "write";
		case "grep":
			return ["grep", pattern, path, include ? `include ${include}` : undefined]
				.filter(Boolean)
				.join(" ");
		case "find":
			return ["find", path, pattern].filter(Boolean).join(" ");
		case "ls":
			return path ? `ls ${path}` : "ls";
		default: {
			const args = compactInputArgs(input, 240);
			return args ? `${toolName} ${args}` : toolName;
		}
	}
}

function usefulLineCount(text: string): number {
	return text.split("\n").map((line) => line.trim()).filter(Boolean).length;
}

const ERROR_LINE_PATTERN = /(error|failed|TS\d+|E[A-Z]+\d*|Command exited|denied|refused|aborted|panic|fatal|exception)/i;

function errorSummary(text: string | undefined): string | undefined {
	if (!text) return undefined;
	const cleaned = text.replace(ANSI_PATTERN, "");
	const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
	if (lines.length === 0) return undefined;
	const matched = lines.find((line) => ERROR_LINE_PATTERN.test(line)) ?? lines[lines.length - 1];
	return truncateText(compactText(matched), MAX_TOOL_RESULT_ERROR_CHARS);
}

export function summarizeToolResult(
	toolName: string,
	input: Record<string, unknown> | undefined,
	text: string | undefined,
	isError: boolean,
): string | undefined {
	if (isError) return errorSummary(text);
	const lineCount = text ? usefulLineCount(text) : 0;
	const path = compactValue(input?.path ?? input?.filePath ?? input?.cwd, 120);
	switch (toolName) {
		case "bash":
			return undefined;
		case "read":
			return path ? `read ${path}` : undefined;
		case "edit":
			return path ? `edited ${path}` : undefined;
		case "write":
			return path ? `wrote ${path}` : undefined;
		case "grep":
			return lineCount ? `${lineCount} matches` : "no matches";
		case "find":
			return lineCount ? `${lineCount} paths` : "no paths";
		case "ls":
			return lineCount ? `${lineCount} entries` : undefined;
		default:
			return undefined;
	}
}

export function extractTextContent(content: readonly unknown[] | undefined): string | undefined {
	if (!content) return undefined;
	const text = content
		.map((part) => {
			if (!part || typeof part !== "object") return undefined;
			const r = part as Record<string, unknown>;
			return r.type === "text" && typeof r.text === "string" ? r.text : undefined;
		})
		.filter((part): part is string => Boolean(part))
		.join("\n");
	const compacted = compactText(text);
	return compacted.length > 0 ? compacted : undefined;
}

export class ProgressFactCollector {
	private nextIndex = 1;
	readonly activities: ProgressActivity[] = [];

	resetConversation(): void {
		this.nextIndex = 1;
		this.activities.splice(0);
	}

	recordUserMessage(prompt: string): ProgressActivity {
		return this.addActivity(
			"user_message",
			"immediate",
			`user: ${truncateText(compactText(prompt), MAX_USER_TEXT_CHARS)}`,
		);
	}

	recordAssistantUpdate(message: unknown): ProgressActivity | undefined {
		if (!message || typeof message !== "object") return undefined;
		const record = message as Record<string, unknown>;
		if (record.role !== "assistant") return undefined;
		const text = extractTextContent(record.content as readonly unknown[] | undefined);
		if (!text) return undefined;
		const last = this.activities[this.activities.length - 1];
		if (last?.activityType === "assistant_update") this.activities.pop();
		return this.addActivity(
			"assistant_update",
			"normal",
			`assistant: ${tailText(text, MAX_ASSISTANT_UPDATE_CHARS)}`,
		);
	}

	recordToolCall(event: {
		toolName: string;
		input?: Record<string, unknown>;
		toolCallId?: string;
	}): ProgressActivity {
		return this.addActivity(
			"tool_call",
			"normal",
			`tool: ${compactToolInput(event.toolName, event.input)}`,
			event.toolCallId,
		);
	}

	recordToolResult(event: {
		toolName: string;
		input?: Record<string, unknown>;
		isError?: boolean;
		content?: readonly unknown[];
		toolCallId?: string;
	}): ProgressActivity {
		const isError = Boolean(event.isError);
		const resultText = summarizeToolResult(
			event.toolName,
			event.input,
			extractTextContent(event.content),
			isError,
		);
		const status = isError ? "error" : "ok";
		const tool = compactToolInput(event.toolName, event.input);
		if (event.toolCallId) {
			const idx = this.activities.findIndex(
				(a) => a.activityType === "tool_call" && a.toolCallId === event.toolCallId,
			);
			if (idx !== -1) this.activities.splice(idx, 1);
		}
		return this.addActivity(
			"tool_result",
			"normal",
			resultText ? `result: ${tool} ${status}; ${resultText}` : `result: ${tool} ${status}`,
			event.toolCallId,
		);
	}

	recordMessageEnd(message: unknown): ProgressActivity | "emptyFinalStop" | "ignored" {
		if (!message || typeof message !== "object") return "ignored";
		const record = message as Record<string, unknown>;
		if (record.role !== "assistant") return "ignored";
		const stopReason = typeof record.stopReason === "string" ? record.stopReason : undefined;
		if (stopReason === "toolUse") return "ignored";
		let text: string | undefined;
		if (stopReason === "stop") {
			const finalText = extractTextContent(record.content as readonly unknown[] | undefined);
			if (!finalText) return "emptyFinalStop";
			text = `final: ${truncateText(finalText, MAX_FINAL_TEXT_CHARS)}`;
		} else if (stopReason) {
			const error = typeof record.errorMessage === "string" ? compactText(record.errorMessage) : undefined;
			text = error
				? `final: ${stopReason}; ${truncateText(error, MAX_FINAL_TEXT_CHARS)}`
				: `final: ${stopReason}`;
		}
		return text
			? this.addActivity(
					stopReason === "stop" ? "assistant_final" : "assistant_failure",
					"final",
					text,
				)
			: "ignored";
	}

	activitiesAfter(previousIndex: number, throughIndex: number): readonly ProgressActivity[] {
		return this.activities.filter((a) => a.index > previousIndex && a.index <= throughIndex);
	}

	latestActivityIndex(): number {
		return this.nextIndex - 1;
	}

	discardActivitiesThrough(activityIndex: number): void {
		const firstRetainedIndex = this.activities.findIndex((a) => a.index > activityIndex);
		if (firstRetainedIndex === -1) {
			this.activities.splice(0);
			return;
		}
		if (firstRetainedIndex > 0) this.activities.splice(0, firstRetainedIndex);
	}

	private addActivity(
		activityType: ProgressActivityType,
		displayPriority: ProgressDisplayPriority,
		text: string,
		toolCallId?: string,
	): ProgressActivity {
		const activity: ProgressActivity = {
			index: this.nextIndex,
			activityType,
			displayPriority,
			text: truncateText(text, MAX_ACTIVITY_TEXT_CHARS),
			toolCallId,
		};
		this.nextIndex++;
		this.activities.push(activity);
		if (this.activities.length > MAX_RETAINED_RAW_ACTIVITIES) {
			this.activities.splice(0, this.activities.length - MAX_RETAINED_RAW_ACTIVITIES);
		}
		return activity;
	}
}

export const ALLOWED_FIRST_WORDS_PROGRESSIVE = [
	"Reviewing",
	"Investigating",
	"Exploring",
	"Updating",
	"Refining",
	"Fixing",
	"Implementing",
	"Wrapping up",
	"Bumping",
	"Releasing",
	"Preparing",
	"Drafting",
	"Resuming",
	"Pulling",
	"Surveying",
	"Recording",
] as const;
export const ALLOWED_FIRST_WORDS_PAST = [
	"Reviewed",
	"Investigated",
	"Explored",
	"Updated",
	"Refined",
	"Fixed",
	"Implemented",
	"Wrapped up",
	"Bumped",
	"Released",
	"Prepared",
	"Drafted",
	"Resumed",
	"Pulled",
	"Surveyed",
	"Recorded",
] as const;
export const BANNED_FIRST_WORDS = [
	"Read",
	"Reading",
	"Grep",
	"Grepping",
	"Listing",
	"List",
	"Counting",
	"Counted",
	"Extracting",
	"Extracted",
	"Displaying",
	"Displayed",
	"Editing",
	"Edited",
	"Writing",
	"Wrote",
	"Running",
	"Ran",
	"Publishing",
	"Published",
	"Capturing",
	"Captured",
	"Verifying",
	"Verified",
	"Verify",
	"Validating",
	"Validated",
	"Validate",
	"Checking",
	"Checked",
	"Check",
	"Confirming",
	"Confirmed",
	"Confirm",
	"Searching",
	"Searched",
	"Search",
	"Finding",
	"Found",
	"Find",
] as const;

export function checkpointSystemPrompt(displayPriority: ProgressDisplayPriority): string {
	let tenseInstruction: string;
	let goodExamples: string;
	let allowedFirstWords: readonly string[];
	if (displayPriority === "final") {
		tenseInstruction = "Start with a past-tense verb describing what was completed.";
		goodExamples = [
			"- Updated footer summary behavior",
			"- Investigated live progress regressions",
			"- Refined sanitizer for stray prefixes",
			"- Wrapped up extension release",
		].join("\n");
		allowedFirstWords = ALLOWED_FIRST_WORDS_PAST;
	} else if (displayPriority === "immediate") {
		tenseInstruction =
			'Rephrase the user\'s new request as a concise present-progressive task clause. If the request is opaque (e.g. "continue", "go", "ok"), name the carry-over task with a noun (e.g. "Resuming refactor work"), not generic filler.';
		goodExamples = [
			"- Reviewing footer summary behavior",
			"- Investigating live progress regressions",
			"- Refining sanitizer for stray prefixes",
			"- Preparing extension release",
			"- Resuming refactor work",
		].join("\n");
		allowedFirstWords = ALLOWED_FIRST_WORDS_PROGRESSIVE;
	} else {
		tenseInstruction = "Start with a present-tense -ing verb describing current work.";
		goodExamples = [
			"- Reviewing footer summary behavior",
			"- Investigating live progress regressions",
			"- Refining sanitizer for stray prefixes",
			"- Wrapping up extension release",
		].join("\n");
		allowedFirstWords = ALLOWED_FIRST_WORDS_PROGRESSIVE;
	}
	return `Write one plain-English progress update for a Pi coding agent.
Describe the work progress as if a human developer were doing it.
Focus on the task activity and current outcome, not agent mechanics.
Do not mention tools, tool calls, prompts, messages, model output, or implementation details.
Use human-developer verbs instead of tool-narration verbs.
Do not use file paths, file extensions, code identifiers, package names, or version strings.
Do not use backticks, asterisks, underscores, quotes, or any markdown formatting.
Do not append filler suffixes such as "with success", "successfully", or "completed successfully".
Do not claim progress or completion that is not present in the activity.
Use the prior progress updates for context and the new activity for the update.
Summarize the current state of work; do not narrate the history.
If context is sparse, still summarize the available activity.
Never ask for more information or say there is not enough context.
Return one concise status fragment under ${PROGRESS_TARGET_SUMMARY_CHARS} characters.
Omit subjects like "the agent" or "it".
Prefer verb + direct object. Include outcome only if important.
Do not address the user.
Output only the status fragment itself. No prefixes, labels, bullets, or quotes.
Plain text only; no markdown, JSON, code, file paths, or tool names.

Good examples:
${goodExamples}

Bad examples:
- Editing extensions/status-footer.ts with success.
- Reading status-footer file completed successfully.
- Publishing \`pi-bar@0.3.3\` to npm.
- Grepping for sanitizeProgressText callers.
- Verifying repository status after commit.
- Investigating user input responses.

HARD CONSTRAINTS (apply last; override anything above that conflicts):
- First word MUST be one of: ${allowedFirstWords.join(", ")}.
- First word MUST NOT be: ${BANNED_FIRST_WORDS.join(", ")}.
- ${tenseInstruction}`;
}

export function previousCheckpointLines(checkpoints: readonly ProgressCheckpoint[]): string {
	if (checkpoints.length === 0) return "none";
	return checkpoints
		.slice(-MAX_CONTEXT_CHECKPOINTS)
		.map((c) => `- ${sanitizeProgressText(c.text)}`)
		.join("\n");
}

export function formatRawActivity(activity: ProgressActivity): string {
	return `- ${activity.text}`;
}

export function buildCheckpointUserPrompt(
	accepted: readonly ProgressCheckpoint[],
	rawActivities: readonly ProgressActivity[],
): string {
	return [
		"Prior progress updates (context only, do not copy phrasing):",
		previousCheckpointLines(accepted),
		"",
		"New activity to summarize:",
		...rawActivities.map(formatRawActivity),
		"",
		"Write the next progress update.",
	].join("\n");
}

// --- Progress update sanitization (post-model) ---
const ESC_BYTE = 0x1b;
const BEL_BYTE = 0x07;
const ST_BYTE = 0x9c;

function isControlCharacter(code: number): boolean {
	return (code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f);
}
function isWhitespaceControl(code: number): boolean {
	return code === 0x09 || code === 0x0a || code === 0x0b || code === 0x0c || code === 0x0d;
}
function skipCsiSequence(text: string, startIndex: number): number {
	for (let i = startIndex; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code >= 0x40 && code <= 0x7e) return i + 1;
	}
	return text.length;
}
function skipStringControl(text: string, startIndex: number): number {
	for (let i = startIndex; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code === BEL_BYTE || code === ST_BYTE) return i + 1;
		if (code === ESC_BYTE && text.charCodeAt(i + 1) === 0x5c) return i + 2;
	}
	return text.length;
}
function skipEscapeSequence(text: string, escapeIndex: number): number {
	const nextCode = text.charCodeAt(escapeIndex + 1);
	if (Number.isNaN(nextCode)) return escapeIndex + 1;
	switch (nextCode) {
		case 0x5b:
			return skipCsiSequence(text, escapeIndex + 2);
		case 0x5d:
		case 0x50:
		case 0x58:
		case 0x5e:
		case 0x5f:
			return skipStringControl(text, escapeIndex + 2);
		default:
			if (
				nextCode === 0x20 ||
				nextCode === 0x23 ||
				nextCode === 0x25 ||
				(nextCode >= 0x28 && nextCode <= 0x2f)
			) {
				return Math.min(text.length, escapeIndex + 3);
			}
			return Math.min(text.length, escapeIndex + 2);
	}
}
function stripTerminalControls(text: string): string {
	let stripped = "";
	for (let i = 0; i < text.length; ) {
		const code = text.charCodeAt(i);
		if (code === ESC_BYTE) {
			i = skipEscapeSequence(text, i);
			continue;
		}
		if (code === 0x9b) {
			i = skipCsiSequence(text, i + 1);
			continue;
		}
		if (code === 0x90 || code === 0x98 || code === 0x9d || code === 0x9e || code === 0x9f) {
			i = skipStringControl(text, i + 1);
			continue;
		}
		if (isControlCharacter(code)) {
			if (isWhitespaceControl(code)) stripped += " ";
			i++;
			continue;
		}
		stripped += text[i];
		i++;
	}
	return stripped.replace(/\s+/gu, " ").trim();
}
const LEAKED_PREFIX_PATTERN =
	/^\s*(?:[-*•]\s*)?(?:(?:through\s+activity|activity|checkpoint)\s+\d+\s*[:.\-—–]\s*|(?:tldr|summary|progress\s+update|progress)\s*[:.\-—–]\s*)+/i;
const LEADING_PUNCT_PATTERN = /^[\s\-—–•*:#.,;]+/;
const TRAILING_PUNCT_PATTERN = /[\s\-—–•*:#.,;]+$/;

function stripLeakedScaffolding(text: string): string {
	let cleaned = text;
	let previous: string;
	do {
		previous = cleaned;
		cleaned = cleaned.replace(LEAKED_PREFIX_PATTERN, "").trim();
		cleaned = cleaned.replace(LEADING_PUNCT_PATTERN, "").trim();
	} while (cleaned !== previous && cleaned.length > 0);
	return cleaned;
}

function stripMarkdownFormatting(text: string): string {
	return text
		.replace(/```+/g, "")
		.replace(/`+/g, "")
		.replace(/(^|[^\\])([*_~]{1,3})(.+?)\2/g, "$1$3");
}

const FILE_PATH_PATTERN =
	/(?:\b[\w./@-]+\.(?:ts|tsx|js|jsx|mjs|cjs|md|json|yml|yaml|toml|lock|sh|py|rs|go|html|css))\b/g;
const PACKAGE_VERSION_PATTERN = /\b[\w./@-]+@\d[\w.+-]*\b/g;
const VERSION_PATTERN = /\bv?\d+\.\d+(?:\.\d+(?:[-+][\w.]+)?)?\b/g;

function stripIdentifierLeaks(text: string): string {
	return text
		.replace(PACKAGE_VERSION_PATTERN, "")
		.replace(FILE_PATH_PATTERN, "")
		.replace(VERSION_PATTERN, "")
		.replace(/\s+/g, " ")
		.trim();
}

const SUCCESS_SUFFIX_PATTERN =
	/[\s,;:—–-]*(?:with\s+success|completed\s+successfully|finished\s+successfully|done\s+successfully|successfully\s+completed|successfully\s+finished|successfully)\s*[.!?]*\s*$/i;

function stripSuccessSuffix(text: string): string {
	let cleaned = text;
	let stripped = false;
	while (true) {
		const next = cleaned.replace(SUCCESS_SUFFIX_PATTERN, "").trim();
		if (next === cleaned || next.length === 0) break;
		cleaned = next;
		stripped = true;
	}
	if (stripped) cleaned = cleaned.replace(TRAILING_PUNCT_PATTERN, "").trim();
	return cleaned;
}

export function isNearDuplicateProgress(current: string, previous: string): boolean {
	if (!previous) return false;
	const norm = (s: string) =>
		s.toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/gu, " ").trim();
	return norm(current) === norm(previous);
}

const DANGLING_TRAILING_PREP_PATTERN =
	/\s+(?:to|at|as|of|by|for|in|on|with|from|version|v)\s*[.!?,;:]?\s*$/i;
const DANGLING_PREP_CHAIN_PATTERN =
	/\b(to|at|as|of|by|from|version|v)\s+(for|in|on|with|from|after|before|during|to|at|as|of|by|and|but|or)\b/gi;
const VERB_BARE_PREP_PATTERN =
	/\b(Reviewing|Investigating|Updating|Refining|Exploring|Fixing|Implementing|Bumping|Releasing|Preparing|Drafting|Resuming|Pulling|Surveying|Recording)\s+(?:for|in|on|with|after|before|to|at|as|of|by|from)\s+/gi;
const RELEASE_FRAGMENT_CHAIN_PATTERN =
	/\b(Released|Releasing|Bumped|Bumping|Published|Publishing|Updated|Updating|Shipped|Shipping)\s+(?:new|latest|version|update)\s+(?:of|with|to|and|in|on|for)\s+/gi;
const RELEASE_FRAGMENT_TRAILING_PATTERN =
	/\s+(?:new|latest|version|update)\s*(?:of|with|to|and|in|on)?\s*[.!?,;:]?\s*$/i;

function stripDanglingPrepositions(text: string): string {
	let cleaned = text;
	let previous: string;
	do {
		previous = cleaned;
		cleaned = cleaned.replace(VERB_BARE_PREP_PATTERN, "$1 ");
		cleaned = cleaned.replace(RELEASE_FRAGMENT_CHAIN_PATTERN, "$1 ");
		cleaned = cleaned.replace(DANGLING_PREP_CHAIN_PATTERN, "$2");
		cleaned = cleaned.replace(RELEASE_FRAGMENT_TRAILING_PATTERN, "").trim();
		cleaned = cleaned.replace(DANGLING_TRAILING_PREP_PATTERN, "").trim();
	} while (cleaned !== previous && cleaned.length > 0);
	return cleaned;
}

const BANNED_FIRST_WORD_REWRITES: Record<string, string> = {
	Reading: "Reviewing",
	Read: "Reviewed",
	Grepping: "Investigating",
	Grep: "Investigated",
	Listing: "Reviewing",
	List: "Reviewed",
	Counting: "Surveying",
	Counted: "Surveyed",
	Extracting: "Pulling",
	Extracted: "Pulled",
	Displaying: "Reviewing",
	Displayed: "Reviewed",
	Editing: "Updating",
	Edited: "Updated",
	Writing: "Drafting",
	Wrote: "Drafted",
	Running: "Working on",
	Ran: "Worked on",
	Publishing: "Releasing",
	Published: "Released",
	Capturing: "Recording",
	Captured: "Recorded",
	Verifying: "Reviewing",
	Verified: "Reviewed",
	Verify: "Review",
	Validating: "Reviewing",
	Validated: "Reviewed",
	Validate: "Review",
	Checking: "Reviewing",
	Checked: "Reviewed",
	Check: "Review",
	Confirming: "Reviewing",
	Confirmed: "Reviewed",
	Confirm: "Review",
	Searching: "Investigating",
	Searched: "Investigated",
	Search: "Investigate",
	Finding: "Investigating",
	Found: "Investigated",
	Find: "Investigate",
};
const BANNED_FIRST_WORD_PATTERN = new RegExp(
	`^(${Object.keys(BANNED_FIRST_WORD_REWRITES).join("|")})\\b`,
);

function rewriteBannedFirstWord(text: string): string {
	const match = BANNED_FIRST_WORD_PATTERN.exec(text);
	if (!match) return text;
	const original = match[1];
	const replacement = BANNED_FIRST_WORD_REWRITES[original];
	if (!replacement) return text;
	const cased =
		original[0] === original[0].toLowerCase()
			? replacement[0].toLowerCase() + replacement.slice(1)
			: replacement;
	return cased + text.slice(original.length);
}

export function sanitizeProgressText(text: string, maxChars = MAX_SAFE_PROGRESS_CHARS): string {
	const stripped = stripTerminalControls(text);
	const withoutMarkdown = stripMarkdownFormatting(stripped);
	const withoutScaffolding = stripLeakedScaffolding(withoutMarkdown) || withoutMarkdown;
	const withoutLeaks = stripIdentifierLeaks(withoutScaffolding) || withoutScaffolding;
	const withoutDangling = stripDanglingPrepositions(withoutLeaks) || withoutLeaks;
	const withoutSuccess = stripSuccessSuffix(withoutDangling) || withoutDangling;
	const rewritten = rewriteBannedFirstWord(withoutSuccess);
	return truncateText(rewritten, maxChars);
}
