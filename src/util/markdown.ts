import matter from "gray-matter";
import { Lang, normalizeLang } from "./lang.js";

export interface Frontmatter {
  readonly title?: string;
  readonly description?: string;
  readonly heading?: string;
}

export interface ParsedDoc {
  readonly frontmatter: Frontmatter;
  readonly body: string;
}

export interface Section {
  readonly headingLevel: 2 | 3;
  readonly heading: string;
  readonly content: string;
}

export interface FencedBlock {
  readonly rawLang: string;
  readonly label: string;
  readonly lang: Lang;
  readonly code: string;
}

export interface CrossLink {
  readonly route: string;
  readonly anchor: string | undefined;
}

const RAW_GH_PREFIX = "https://raw.githubusercontent.com/razorpay/markdown-docs/master/";
const HEADING_PATTERN = /^(?<hashes>#{2,3})\s+(?<text>.+?)\s*$/gm;
const FENCE_PATTERN = /^```(?<header>[^\n]*)\n(?<body>[\s\S]*?)\n```/gm;
const HEADER_PATTERN = /^(?<lang>[^\s:]+)(?:\s*:\s*(?<label>.+))?$/;
const CHARS_PER_TOKEN = 4;

export function parseDoc(rawMarkdown: string): ParsedDoc {
  const parsed = matter(rawMarkdown);
  const data = parsed.data as Record<string, unknown>;
  const fm: { title?: string; description?: string; heading?: string } = {};
  if (typeof data["title"] === "string") fm.title = data["title"];
  if (typeof data["description"] === "string") fm.description = data["description"];
  if (typeof data["heading"] === "string") fm.heading = data["heading"];
  return { frontmatter: fm, body: parsed.content };
}

/**
 * Split body by H2 or H3 boundaries. Content prior to first matching heading
 * is returned as a synthetic section with empty heading and matching level.
 */
export function splitByHeadingLevel(body: string, level: 2 | 3): Section[] {
  const out: Section[] = [];
  const expectedHashes = "#".repeat(level);
  const pattern = new RegExp(`^${expectedHashes}\\s+(?<text>.+?)\\s*$`, "gm");

  const matches: { index: number; heading: string }[] = [];
  for (const m of body.matchAll(pattern)) {
    if (m.index === undefined || m.groups?.["text"] === undefined) continue;
    matches.push({ index: m.index, heading: m.groups["text"] });
  }

  if (matches.length === 0) {
    if (body.trim().length > 0) {
      out.push({ headingLevel: level, heading: "", content: body });
    }
    return out;
  }

  // Preamble before first heading
  const firstMatch = matches[0];
  if (firstMatch !== undefined && firstMatch.index > 0) {
    const preamble = body.slice(0, firstMatch.index);
    if (preamble.trim().length > 0) {
      out.push({ headingLevel: level, heading: "", content: preamble });
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    if (current === undefined) continue;
    const next = matches[i + 1];
    const end = next?.index ?? body.length;
    const content = body.slice(current.index, end);
    out.push({ headingLevel: level, heading: current.heading, content });
  }

  return out;
}

/** Reset and re-iterate a global regex; pulled out for clarity. */
export function extractFencedBlocks(body: string): FencedBlock[] {
  const out: FencedBlock[] = [];
  // Fresh RegExp instance to avoid stateful lastIndex pitfalls.
  const re = new RegExp(FENCE_PATTERN.source, FENCE_PATTERN.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const header = (m.groups?.["header"] ?? "").trim();
    const codeBody = m.groups?.["body"] ?? "";
    if (header === "") {
      out.push({ rawLang: "", label: "", lang: Lang.Unknown, code: codeBody });
      continue;
    }
    const headerMatch = HEADER_PATTERN.exec(header);
    const rawLang = headerMatch?.groups?.["lang"] ?? "";
    const label = headerMatch?.groups?.["label"]?.trim() ?? "";
    out.push({
      rawLang,
      label,
      lang: normalizeLang(rawLang),
      code: codeBody,
    });
  }
  return out;
}

export function extractCrossLinks(body: string): CrossLink[] {
  const out: CrossLink[] = [];
  const seen = new Set<string>();
  // Match anywhere in the body — markdown links, plain URLs, tables, etc.
  const re = new RegExp(
    RAW_GH_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      String.raw`(?<route>[^\s)\]"#]+?)\.md(?:#(?<anchor>[^\s)\]"]+))?`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const route = m.groups?.["route"];
    if (route === undefined) continue;
    const anchor = m.groups?.["anchor"];
    const key = `${route}#${anchor ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ route, anchor });
  }
  return out;
}

export function approxTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
