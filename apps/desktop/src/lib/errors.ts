export function appErrorMessage(
  error: unknown,
  fallback = "The operation could not be completed.",
): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    if (Array.isArray(message)) {
      const joined = message.filter((item) => typeof item === "string").join(". ");
      if (joined) return joined;
    }
  }
  return fallback;
}
