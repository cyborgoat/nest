import type { PackProject } from "@nest/shared";

export function publishDescriptionDefault(
  latestRelease: PackProject | undefined,
  localDescription: string,
) {
  return latestRelease?.description ?? localDescription;
}
