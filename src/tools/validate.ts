/**
 * `validate_razorpay_code` MCP tool — runs the rule set over a code snippet
 * and returns structured issues with resolved citation URLs.
 *
 * The tool description tells the agent WHEN to use it: you have just written
 * or are about to apply Razorpay integration code, and you want a second pair
 * of eyes before shipping. The validator is local, fast, and deterministic
 * — there's no reason not to call it on every Razorpay change.
 */

import type { ValidationRunner } from "../validator/runner.js";
import type { Concern, ValidationReport } from "../validator/types.js";
import {
  ValidateInputSchema,
  ValidateOutputSchema,
  type ValidateInput,
  type ValidateOutput,
} from "./schemas.js";

export const VALIDATE_TOOL_NAME = "validate_razorpay_code";

export const VALIDATE_TOOL_DESCRIPTION = `Lint a Razorpay integration code snippet against ~30 hand-curated rules and return structured issues with citations to the canonical doc.

Use this when you have just written or are about to apply Razorpay integration code:
- Webhook handlers (signature verification, response codes, idempotency)
- Order/payment/refund creation (amounts, currency, idempotency, receipts)
- Subscription / Payment Link / UPI flows
- Anywhere API keys appear in source

Each issue carries: rule id, severity (error/warning/info), explanation, fix suggestion, and a razorpay.com citation URL. Local + deterministic — call it on every Razorpay change before shipping.

Input is the raw code (≤ 50 KB) plus optional language hint or filename. The tool detects the SDK language automatically when not provided.`.trim();

export interface ValidateToolDeps {
  readonly runner: ValidationRunner;
}

/** Convert MCP input → runner input (camel-case + lang resolution). */
function toRunnerInput(input: ValidateInput): {
  code: string;
  languageHint?: string;
  concern?: Concern;
} {
  const languageHint = input.language ?? input.filename;
  return {
    code: input.code,
    ...(languageHint !== undefined && { languageHint }),
    ...(input.concern !== undefined && { concern: input.concern as Concern }),
  };
}

/** Convert runner report → MCP output (snake-case JSON). */
export function toValidateOutput(report: ValidationReport): ValidateOutput {
  return {
    issues: report.issues.map((i) => ({
      rule_id: i.ruleId,
      severity: i.severity,
      title: i.title,
      ...(i.line !== undefined && { line: i.line }),
      ...(i.column !== undefined && { column: i.column }),
      snippet: i.snippet,
      explanation: i.explanation,
      fix_suggestion: i.fixSuggestion,
      citation: {
        route: i.citation.route,
        ...(i.citation.section !== undefined && { section: i.citation.section }),
        url: i.citation.url,
        excerpt: i.citation.excerpt,
      },
    })),
    summary: {
      total: report.summary.total,
      by_severity: {
        error: report.summary.bySeverity.error,
        warning: report.summary.bySeverity.warning,
        info: report.summary.bySeverity.info,
      },
      rules_evaluated: report.summary.rulesEvaluated,
      language_detected: report.summary.languageDetected,
    },
  };
}

export function runValidateTool(
  deps: ValidateToolDeps,
  rawInput: unknown,
): ValidateOutput {
  const input = ValidateInputSchema.parse(rawInput);
  const report = deps.runner.validate(toRunnerInput(input));
  const output = toValidateOutput(report);
  return ValidateOutputSchema.parse(output);
}
