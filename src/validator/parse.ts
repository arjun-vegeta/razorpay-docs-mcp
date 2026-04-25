/**
 * Lightweight language detection + comment/string masking.
 *
 * Detection: filename hint takes priority; otherwise score the code against
 * per-language signature keywords and pick the winner. Single-pass — fast,
 * good enough for the snippet-sized inputs the validator gets.
 *
 * Masking: replaces comment + string-literal contents with spaces (preserves
 * line/column offsets) so detectors don't false-positive on documentation
 * snippets embedded in strings.
 */

import { Lang } from "../util/lang.js";

interface LangSignature {
  readonly lang: Lang;
  readonly extensions: readonly string[];
  readonly keywords: readonly RegExp[];
}

const SIGNATURES: readonly LangSignature[] = [
  {
    lang: Lang.Node,
    extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"],
    keywords: [
      /\brequire\s*\(/,
      /\bimport\s+[\s\S]*?from\s+["']/,
      /\bconst\s+\w+\s*=/,
      /\blet\s+\w+\s*=/,
      /\b(module\.exports|exports\.\w+)\b/,
      /\bnew\s+Razorpay\s*\(/,
      /=>/,
    ],
  },
  {
    lang: Lang.Python,
    extensions: [".py"],
    keywords: [
      /^\s*def\s+\w+\s*\(/m,
      /^\s*import\s+\w+/m,
      /^\s*from\s+\w+\s+import\b/m,
      /\brazorpay\.Client\s*\(/,
      /:\s*$/m,
    ],
  },
  {
    lang: Lang.Php,
    extensions: [".php"],
    keywords: [
      /<\?php/,
      /\$\w+\s*=/,
      /->\w+\s*\(/,
      /\\Razorpay\\Api\\Api/,
      /\bjson_encode\s*\(/,
    ],
  },
  {
    lang: Lang.Java,
    extensions: [".java"],
    keywords: [
      /\bpublic\s+(class|static|void)\b/,
      /\bSystem\.out\.println\b/,
      /\bnew\s+RazorpayClient\s*\(/,
      /\bimport\s+com\.razorpay\b/,
    ],
  },
  {
    lang: Lang.Ruby,
    extensions: [".rb"],
    keywords: [
      /^\s*def\s+\w+/m,
      /\brequire\s+["']razorpay["']/,
      /\bRazorpay\s*::\s*Client\b/,
      /\bend\s*$/m,
      /:\w+\s*=>/,
    ],
  },
  {
    lang: Lang.Go,
    extensions: [".go"],
    keywords: [
      /\bpackage\s+\w+/,
      /^\s*import\s+["(]/m,
      /\bfunc\s+\w+/,
      /\brazorpay\.NewClient\b/,
      /:=/,
    ],
  },
  {
    lang: Lang.Dotnet,
    extensions: [".cs"],
    keywords: [
      /\busing\s+System;/,
      /\bnamespace\s+\w+/,
      /\bnew\s+RazorpayClient\s*\(/,
      /\bvar\s+\w+\s*=/,
    ],
  },
  {
    lang: Lang.Curl,
    extensions: [".sh", ".bash"],
    keywords: [/\bcurl\s+(-[A-Za-z]+\s+)*https?:\/\//, /\bcurl\s+\\?\s*$/m],
  },
];

/**
 * Detect language. `hint` (filename or explicit lang token) wins if it maps
 * cleanly. Otherwise we score keyword matches per language and return the
 * highest scorer (`Lang.Unknown` if no signature scores ≥ 1).
 */
export function detectLanguage(code: string, hint?: string): Lang {
  if (hint !== undefined && hint.length > 0) {
    const hinted = languageFromHint(hint);
    if (hinted !== Lang.Unknown) return hinted;
  }
  let best: Lang = Lang.Unknown;
  let bestScore = 0;
  for (const sig of SIGNATURES) {
    let score = 0;
    for (const kw of sig.keywords) {
      if (kw.test(code)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = sig.lang;
    }
  }
  return bestScore >= 1 ? best : Lang.Unknown;
}

function languageFromHint(hint: string): Lang {
  const lower = hint.trim().toLowerCase();
  for (const sig of SIGNATURES) {
    for (const ext of sig.extensions) {
      if (lower.endsWith(ext)) return sig.lang;
    }
  }
  // Token form: "node", "python", "ts" etc.
  switch (lower) {
    case "node":
    case "nodejs":
    case "js":
    case "javascript":
    case "ts":
    case "typescript":
      return Lang.Node;
    case "python":
    case "py":
      return Lang.Python;
    case "php":
      return Lang.Php;
    case "java":
      return Lang.Java;
    case "ruby":
    case "rb":
      return Lang.Ruby;
    case "go":
    case "golang":
      return Lang.Go;
    case "dotnet":
    case "csharp":
    case "cs":
      return Lang.Dotnet;
    case "curl":
    case "bash":
    case "shell":
      return Lang.Curl;
    default:
      return Lang.Unknown;
  }
}

/**
 * Replace comment contents with spaces. Preserves length and newline positions
 * so line/column reporting still aligns with the original.
 *
 * String literals are intentionally NOT masked — many rules need to inspect
 * string content (header names, currency codes, hardcoded API keys). Rules
 * that want to suppress matches inside doc-strings can write a heuristic that
 * checks the surrounding tokens themselves; the common case (commented-out
 * code) is what this masker handles.
 *
 * To avoid mistaking `'string with // inside'` for a comment, we walk
 * character-by-character and skip past string literals first.
 */
export function maskComments(code: string, lang: Lang): string {
  const out = code.split("");
  const n = code.length;
  let i = 0;

  const blockComment = (open: string, close: string): boolean => {
    if (!code.startsWith(open, i)) return false;
    const end = code.indexOf(close, i + open.length);
    const stop = end === -1 ? n : end + close.length;
    for (let j = i; j < stop; j += 1) {
      if (code[j] !== "\n") out[j] = " ";
    }
    i = stop;
    return true;
  };

  const lineComment = (token: string): boolean => {
    if (!code.startsWith(token, i)) return false;
    while (i < n && code[i] !== "\n") {
      out[i] = " ";
      i += 1;
    }
    return true;
  };

  /** Skip over a string literal (without modifying out). */
  const skipString = (q: string): boolean => {
    if (code[i] !== q) return false;
    i += 1;
    while (i < n && code[i] !== q) {
      if (code[i] === "\\" && i + 1 < n) {
        i += 2;
        continue;
      }
      if (code[i] === "\n") return true;
      i += 1;
    }
    if (i < n) i += 1;
    return true;
  };

  while (i < n) {
    if (lang === Lang.Python && (code.startsWith('"""', i) || code.startsWith("'''", i))) {
      const open = code.startsWith('"""', i) ? '"""' : "'''";
      if (blockComment(open, open)) continue;
    }
    if (lang === Lang.Python || lang === Lang.Ruby || lang === Lang.Curl) {
      if (lineComment("#")) continue;
    }
    if (
      lang === Lang.Node ||
      lang === Lang.Java ||
      lang === Lang.Php ||
      lang === Lang.Go ||
      lang === Lang.Dotnet ||
      lang === Lang.Kotlin
    ) {
      if (lineComment("//")) continue;
      if (blockComment("/*", "*/")) continue;
    }
    if (lang === Lang.Php) {
      if (lineComment("#")) continue;
    }
    if (skipString('"')) continue;
    if (skipString("'")) continue;
    if (lang === Lang.Node && skipString("`")) continue;
    i += 1;
  }
  return out.join("");
}

export function splitLines(code: string): readonly string[] {
  return code.split(/\r?\n/);
}

/**
 * Find 1-indexed line + column for a string offset. Stable contract for
 * detectors that report a regex match index.
 */
export function offsetToLineCol(code: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let j = 0; j < offset && j < code.length; j += 1) {
    if (code[j] === "\n") {
      line += 1;
      lineStart = j + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}
