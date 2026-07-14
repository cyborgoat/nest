export type PackRelease = {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Vault folder name; equals `id`. */
  path: string;
  yanked?: boolean;
};

export type PackProject = {
  id: string;
  name: string;
  description: string;
  latest_version: string;
  versions: string[];
};

/** @deprecated Use PackProject / PackRelease — kept for older clients during transition */
export type Pack = PackRelease;
