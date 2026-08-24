import type {
  BackendDescriptor,
  ChatBackend,
  ChatMode,
  ModelSelection,
} from "@nest/shared";

export type BackendOption = {
  id: ChatBackend;
  label: string;
  disabled: boolean;
  disabledReason: string | null;
};

export type ModelOption = {
  id: "default" | string;
  label: string;
};

export type ModeOption = {
  id: ChatMode;
  label: string;
  disabled: boolean;
  disabledReason: string | null;
};

export type SelectionCapsules = {
  backends: BackendOption[];
  models: ModelOption[];
  modes: ModeOption[];
  canChangeBackend: boolean;
};

export const NEST_LABEL = "Nest Agent";
export const CLAUDE_LABEL = "Claude";

export function deriveCapsules(params: {
  descriptors: BackendDescriptor[];
  activeBackendId: ChatBackend;
  boundBackend: ChatBackend | null;
}): SelectionCapsules {
  const active = params.descriptors.find(
    (descriptor) => descriptor.id === params.activeBackendId,
  );
  const backends = params.descriptors
    .filter(
      (descriptor) =>
        descriptor.enabled || descriptor.id === params.activeBackendId,
    )
    .map((descriptor) => {
      const disabled =
        descriptor.availability !== "ready" &&
        descriptor.availability !== "last_verified";
      return {
        id: descriptor.id,
        label: descriptor.label,
        disabled,
        disabledReason: disabled
          ? (descriptor.message ?? descriptor.reason_code ?? "Backend unavailable")
          : null,
      };
    });
  const models = (active?.models ?? []).map((model) => ({
    id:
      model.selection.kind === "default"
        ? "default"
        : (model.selection.value ?? "default"),
    label: model.label,
  }));
  const modes = (active?.modes ?? []).map((mode) => ({
    id: mode.id,
    label: capsuleModeLabel(mode.id),
    disabled: !mode.available,
    disabledReason: mode.available
      ? null
      : (mode.message ?? mode.reason_code ?? "Mode unavailable"),
  }));

  return {
    backends,
    models,
    modes,
    canChangeBackend: params.boundBackend === null,
  };
}

export function modelSelectionFromCapsule(
  capsuleId: string,
): ModelSelection {
  if (capsuleId === "default") {
    return { kind: "default", value: null };
  }
  return { kind: "explicit", value: capsuleId };
}

export function capsuleFromModelSelection(
  selection: ModelSelection,
): string {
  return selection.kind === "default" ? "default" : (selection.value ?? "default");
}

export function capsuleModeLabel(mode: ChatMode): string {
  return mode === "agent" ? "Agent" : "Ask";
}
