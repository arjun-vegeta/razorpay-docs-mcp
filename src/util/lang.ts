/**
 * Canonical SDK languages we serve code samples for.
 * Plus `json` for response payloads (separate axis from SDK code).
 *
 * Razorpay docs use `\`\`\`<lang>: <label>` fences. Multiple raw forms
 * normalize to the same canonical language (e.g. nodejs/js/javascript → node).
 */

export const Lang = {
  Node: "node",
  Python: "python",
  Php: "php",
  Java: "java",
  Ruby: "ruby",
  Go: "go",
  Dotnet: "dotnet",
  Kotlin: "kotlin",
  Curl: "curl",
  Json: "json",
  Unknown: "unknown",
} as const;
export type Lang = (typeof Lang)[keyof typeof Lang];

const SDK_LANGS = new Set<Lang>([
  Lang.Node,
  Lang.Python,
  Lang.Php,
  Lang.Java,
  Lang.Ruby,
  Lang.Go,
  Lang.Dotnet,
  Lang.Kotlin,
  Lang.Curl,
]);

const RAW_TO_LANG: ReadonlyMap<string, Lang> = new Map([
  // Node family
  ["node", Lang.Node],
  ["nodejs", Lang.Node],
  ["js", Lang.Node],
  ["javascript", Lang.Node],
  ["typescript", Lang.Node],
  ["ts", Lang.Node],
  // Python
  ["python", Lang.Python],
  ["py", Lang.Python],
  // PHP
  ["php", Lang.Php],
  // Java
  ["java", Lang.Java],
  // Ruby
  ["ruby", Lang.Ruby],
  ["rb", Lang.Ruby],
  // Go
  ["go", Lang.Go],
  ["golang", Lang.Go],
  // .NET
  ["dotnet", Lang.Dotnet],
  ["csharp", Lang.Dotnet],
  ["cs", Lang.Dotnet],
  ["c", Lang.Dotnet],
  // Kotlin
  ["kotlin", Lang.Kotlin],
  ["kt", Lang.Kotlin],
  // curl
  ["curl", Lang.Curl],
  ["bash", Lang.Curl],
  ["shell", Lang.Curl],
  ["sh", Lang.Curl],
  // json
  ["json", Lang.Json],
]);

export function normalizeLang(raw: string): Lang {
  const key = raw.trim().toLowerCase();
  return RAW_TO_LANG.get(key) ?? Lang.Unknown;
}

export function isSdkLang(lang: Lang): boolean {
  return SDK_LANGS.has(lang);
}

export function allSdkLangs(): readonly Lang[] {
  return [...SDK_LANGS];
}
