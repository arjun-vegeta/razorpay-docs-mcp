import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const RouteEntrySchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  category: z.string(),
  url: z.string().url(),
});

export const ManifestSchema = z.object({
  version: z.string(),
  generated: z.string(),
  total: z.number().int().positive(),
  base_url: z.string().url(),
  routes: z.record(RouteEntrySchema),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type RouteEntry = z.infer<typeof RouteEntrySchema>;

export class ManifestRouteNotFoundError extends Error {
  public override readonly name = "ManifestRouteNotFoundError";
  public constructor(
    message: string,
    public readonly route: string,
  ) {
    super(message);
  }
}

export function manifestPath(sourceDir: string): string {
  return resolve(sourceDir, "_manifest.json");
}

export function loadManifest(sourceDir: string): Manifest {
  const path = manifestPath(sourceDir);
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  return ManifestSchema.parse(raw);
}

export function getRoute(manifest: Manifest, route: string): RouteEntry {
  const entry = manifest.routes[route];
  if (entry === undefined) {
    throw new ManifestRouteNotFoundError(
      `route '${route}' not in manifest (n=${Object.keys(manifest.routes).length})`,
      route,
    );
  }
  return entry;
}

export function listRoutes(manifest: Manifest): readonly string[] {
  return Object.keys(manifest.routes);
}
