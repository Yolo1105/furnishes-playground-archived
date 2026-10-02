/**
 * Compose a className string from any mix of strings, falsy values, and
 * truthy/falsy maps. Mirrors the zip's helper of the same name and the
 * common `clsx`/`classnames` API without pulling in the dependency.
 */
type ClassValue = string | number | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
