/** Standalone app serves studio at `/` (prod uses `/playground`). */
export const STUDIO_PLAYGROUND_PATH_PREFIX = "/" as const;

export function isStudioPlaygroundPathname(pathname: string): boolean {
  // Standalone: the whole app is the playground.
  if (pathname === "/" || pathname === "") return true;
  return (
    pathname === "/playground" || pathname.startsWith("/playground/")
  );
}
