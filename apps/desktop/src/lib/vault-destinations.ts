import type { HubUser, InstalledPack, TreeNode } from "@nest/shared";
import {
  indexInstalledPacksById,
  indexInstalledPacksByLocalPath,
} from "@/lib/pack-index";
import { canEditPack } from "@/lib/pack-permissions";

export type VaultDestination = {
  path: string;
  label: string;
  packId: string;
};

export function collectEditableVaultDestinations(
  tree: TreeNode[],
  installed: InstalledPack[],
  hubUser: HubUser | null,
): VaultDestination[] {
  const packsByPath = indexInstalledPacksByLocalPath(installed);
  for (const [id, pack] of indexInstalledPacksById(installed)) {
    packsByPath.set(id, pack);
  }

  const destinations: VaultDestination[] = [];
  for (const root of tree) {
    if (root.kind !== "folder") continue;
    const pack = packsByPath.get(root.path);
    if (!pack || !canEditPack(pack, hubUser)) continue;

    const visit = (node: TreeNode) => {
      if (node.kind !== "folder") return;
      const relativePath = node.path.slice(root.path.length).replace(/^\//, "");
      destinations.push({
        path: node.path,
        label: relativePath ? `${pack.name} / ${relativePath}` : pack.name,
        packId: pack.pack_id,
      });
      node.children?.forEach(visit);
    };
    visit(root);
  }
  return destinations;
}

export function defaultVaultDestination(
  destinations: VaultDestination[],
  preferredPath?: string,
): string {
  if (
    preferredPath &&
    destinations.some((destination) => destination.path === preferredPath)
  ) {
    return preferredPath;
  }
  return destinations[0]?.path ?? "";
}
