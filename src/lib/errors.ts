// Centralized error-to-string for UI display.
//
// Supabase responses bubble up as plain objects of the shape
// `{ message, details, hint, code }`. Naively calling `String(e)` on those
// produces the legendary "[object Object]" UX bug. This helper pulls out
// whichever human-readable parts are present, with a JSON fallback so a
// genuinely opaque object at least surfaces *some* shape rather than nothing.
export function formatErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const obj = e as {
      message?: unknown;
      error_description?: unknown;
      error?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    const parts = [obj.message, obj.error_description, obj.error, obj.details, obj.hint]
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    if (parts.length) {
      return obj.code ? `${parts[0]} (${String(obj.code)})` : parts[0];
    }
    try {
      return JSON.stringify(e);
    } catch {
      return "Unknown error";
    }
  }
  return String(e);
}
