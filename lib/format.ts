/** Shared formatting/value helpers used across the app. */

/** "phone_screen" -> "phone screen" */
export function humanize(s?: string | null) {
  return (s || "").replace(/_/g, " ");
}

export function fullName(p?: { first_name?: string | null; last_name?: string | null } | null) {
  return [p?.first_name, p?.last_name].filter(Boolean).join(" ");
}

export function initials(name?: string | null) {
  return (name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

export function formatDate(v?: string | null, fallback = "") {
  return v ? new Date(v).toLocaleDateString() : fallback;
}

export function formatDateTime(v?: string | null, fallback = "") {
  return v ? new Date(v).toLocaleString() : fallback;
}

export function isOverdue(due?: string | null) {
  return !!due && new Date(due) < new Date();
}

/** Whole days between two timestamps (defaults to now). */
export function daysBetween(from: string, to?: string) {
  return Math.max(0, Math.round(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 86400000));
}

/** Adds a tag without duplicates. */
export function withTag(tags: string[] | null | undefined, tag: string) {
  return Array.from(new Set([...(tags || []), tag]));
}

/** Counts rows by a key, e.g. candidates by status. */
export function countBy<T>(rows: T[], key: (row: T) => string | null | undefined, unknown = "unknown") {
  return rows.reduce((acc: Record<string, number>, row) => {
    const k = key(row) || unknown;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}

/** Average of a numeric mapping over rows, or null when empty. */
export function averageBy<T>(rows: T[], value: (row: T) => number) {
  return rows.length ? Math.round(rows.reduce((sum, row) => sum + value(row), 0) / rows.length) : null;
}
