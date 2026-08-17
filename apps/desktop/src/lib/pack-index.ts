import type { InstalledPack } from "@nest/shared";

export function packRootFromPath(path: string): string {
  return path.split("/")[0] ?? path;
}

export function indexInstalledPacksByLocalPath(
  installed: InstalledPack[],
): Map<string, InstalledPack> {
  const map = new Map<string, InstalledPack>();
  for (const pack of installed) {
    map.set(pack.local_path, pack);
  }
  return map;
}

export function indexInstalledPacksById(
  installed: InstalledPack[],
): Map<string, InstalledPack> {
  const map = new Map<string, InstalledPack>();
  for (const pack of installed) {
    map.set(pack.pack_id, pack);
  }
  return map;
}
