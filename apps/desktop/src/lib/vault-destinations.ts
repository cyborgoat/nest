import type { HubUser, InstalledPack, TreeNode } from "@nest/shared";
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
  const packsByPath = new Map<string, InstalledPack>();
  for (const pack of installed) {
    packsByPath.set(pack.local_path, pack);
    packsByPath.set(pack.pack_id, pack);
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
