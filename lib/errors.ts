/**
 * Error helpers. Supabase returns failures as an `error` field on the result
 * instead of throwing, so every call site has to check it explicitly — these
 * wrappers make that check the default and keep the message the user sees and
 * the message written to the console in sync.
 */

export type Result<T> = { data: T | null; error: { message: string } | null };

export class AppError extends Error {
  readonly context: string;
  constructor(context: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AppError";
    this.context = context;
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Unexpected error";
}

/** Logs with a stable prefix so failures are traceable in the console. */
export function logError(context: string, e: unknown): string {
  const message = errorMessage(e);
  console.error(`[ats:${context}] ${message}`, e);
  return message;
}

/** Logs, then tells the user. Use for actions the user explicitly triggered. */
export function reportError(context: string, e: unknown, prefix?: string): string {
  const message = logError(context, e);
  if (typeof window !== "undefined") window.alert(`${prefix || context} failed: ${message}`);
  return message;
}

/**
 * Awaits a Supabase query and throws an AppError when it failed, so callers can
 * use one try/catch instead of checking `error` on every result.
 */
export async function must<T>(context: string, query: PromiseLike<Result<T>>): Promise<T | null> {
  let result: Result<T>;
  try {
    result = await query;
  } catch (e) {
    throw new AppError(context, errorMessage(e), { cause: e });
  }
  if (result.error) throw new AppError(context, result.error.message, { cause: result.error });
  return result.data;
}

/** Same as `must`, for list queries that should never yield null. */
export async function mustRows<T>(context: string, query: PromiseLike<Result<T[]>>): Promise<T[]> {
  return (await must(context, query)) || [];
}

/** Same as `must`, for `{ count: "exact", head: true }` queries. */
export async function mustCount(context: string, query: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  let result: { count: number | null; error: { message: string } | null };
  try {
    result = await query;
  } catch (e) {
    throw new AppError(context, errorMessage(e), { cause: e });
  }
  if (result.error) throw new AppError(context, result.error.message, { cause: result.error });
  return result.count || 0;
}

/**
 * Runs a mutation and returns the error message, or null on success. Prefer this
 * over ignoring the result when a component wants to render the failure inline.
 */
export async function tryRun(context: string, query: PromiseLike<Result<unknown>>): Promise<string | null> {
  try {
    await must(context, query);
    return null;
  } catch (e) {
    return logError(context, e);
  }
}
