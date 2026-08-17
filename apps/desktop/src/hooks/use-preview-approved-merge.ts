import type { PackMergePreview } from "@nest/shared";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { appErrorMessage } from "@/lib/errors";

export function usePreviewApprovedMerge() {
  const [preview, setPreview] = useState<PackMergePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const previewMerge = async (packId: string, requestId: string) => {
    setPreviewing(true);
    try {
      setPreview(await api.hubPreviewApprovedMerge(packId, requestId));
    } catch (error) {
      toast.error("Could not prepare merge", {
        description: appErrorMessage(error),
      });
    } finally {
      setPreviewing(false);
    }
  };

  return { preview, setPreview, previewing, previewMerge };
}
