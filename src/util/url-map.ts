import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

export const UrlMapSchema = z.record(z.string());
export type UrlMap = z.infer<typeof UrlMapSchema>;

export function urlMapPath(sourceDir: string): string {
  return resolve(sourceDir, "_url-md-map.json");
}

export function loadUrlMap(sourceDir: string): UrlMap {
  const raw: unknown = JSON.parse(readFileSync(urlMapPath(sourceDir), "utf8"));
  return UrlMapSchema.parse(raw);
}

const DOCS_BASE = "https://razorpay.com";

export function routeToCanonicalUrl(route: string): string {
  // Razorpay's docs URLs follow /docs/<route>/. We construct directly rather
  // than reverse-lookup against url-md-map for performance.
  return `${DOCS_BASE}/docs/${route}/`;
}
