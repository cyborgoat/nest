export function hasPublishableChanges({
  isFirstPublish,
  hasFileChanges,
  requestType,
  currentDescription,
  description,
}: {
  isFirstPublish: boolean;
  hasFileChanges: boolean | undefined;
  requestType: "release" | "live_patch";
  currentDescription: string;
  description: string;
}) {
  if (isFirstPublish || hasFileChanges !== false) return true;
  return (
    requestType === "release" &&
    description.trim() !== currentDescription.trim()
  );
}
