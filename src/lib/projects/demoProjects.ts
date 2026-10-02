import type { Project } from "./types";

/**
 * The default project ID used when the store hasn't loaded a real
 * project yet (e.g. first boot, signed-out state). Matches the id of
 * `DEMO_PROJECTS[0]` below — which is the project a fresh user lands
 * on. Centralised here so chat / suggestions / persistence don't drift
 * (an earlier audit found this string hardcoded in 4 separate places).
 *
 * As of v0.40.3, the default project is "blank-test" — a completely
 * empty scene that loads with no apartamento.glb, no synthetic walls,
 * no seeded furniture. This makes the first-boot experience a clean
 * canvas for testing text-to-3D + chat against. The previous default
 * scene (apartamento.glb + seeded furniture) is now under the
 * "demo-apartment" project, accessible from the project switcher.
 */
export const DEFAULT_PROJECT_ID = "blank-test";

/**
 * Hardcoded demo projects. The first entry is the default current
 * project on app boot ("Blank Canvas" — empty scene for testing);
 * the remaining entries appear in the switcher dropdown as projects
 * to switch to.
 *
 * Names + relative-time strings are copied verbatim from the JSX
 * prototype's `OTHER_PROJECTS` constant, with one new addition:
 * the "Demo Apartment" project preserves the previous default
 * experience (apartamento.glb load + seeded furniture catalog) for
 * users who want to explore the pre-existing setup.
 */
export const DEMO_PROJECTS: Project[] = [
  {
    id: DEFAULT_PROJECT_ID,
    name: "Blank Canvas",
    updated: "just now",
    // Tells usePersistence's `resetForNewProject` to skip the
    // viewer-source default and stay in room-director mode with
    // roomMeta=null. Result: empty 3D viewport, no inventory items,
    // no walls. Generation outputs (text-to-3D from chat dock,
    // full rooms from the director) drop straight into this empty
    // canvas.
    blankScene: true,
  },
  {
    id: "demo-apartment",
    name: "Demo Apartment",
    updated: "just now",
    // The legacy default — apartamento.glb loads, the catalog seeds
    // its initial furniture set, walls come from the GLB structure
    // mesh. Switch to this project to explore the pre-existing
    // setup or verify viewer-source behaviour.
  },
  {
    id: "p1",
    name: "Coastal Bedroom",
    updated: "2h ago",
  },
  {
    id: "p2",
    name: "Kitchen Remodel",
    updated: "Yesterday",
  },
  {
    id: "p3",
    name: "Reading Nook Ideas",
    updated: "3 days ago",
  },
];
