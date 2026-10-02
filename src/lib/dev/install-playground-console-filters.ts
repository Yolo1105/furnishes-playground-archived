/**
 * Playground dev-only: three.js r184+ deprecates `THREE.Clock`, but
 * @react-three/fiber still does `new THREE.Clock()` internally — the
 * warning is harmless until R3F switches to `THREE.Timer`.
 *
 * Import this module for side effects (see PlaygroundStudioClient).
 */
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  const origWarn = console.warn.bind(console);
  console.warn = (...args: Parameters<typeof console.warn>) => {
    const head = args[0];
    if (
      typeof head === "string" &&
      head.includes("THREE.Clock") &&
      head.includes("deprecated")
    ) {
      return;
    }
    origWarn(...args);
  };
}
