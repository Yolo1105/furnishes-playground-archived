/**
 * Panel / piece surface materials for Properties picker + 3D preview.
 * Procedural wood reuses `makeFloorTexture` (grain); paint is solid.
 */

export type PanelMaterialFinish = "wood" | "paint";

export type PanelMaterial = {
  id: string;
  label: string;
  /** Base color hex used on the piece + Inventory swatch. */
  color: string;
  finish: PanelMaterialFinish;
};

export const PANEL_MATERIALS: PanelMaterial[] = [
  {
    id: "oak",
    label: "Oak",
    color: "#C9A57B",
    finish: "wood",
  },
  {
    id: "walnut",
    label: "Walnut",
    color: "#6B4A2E",
    finish: "wood",
  },
  {
    id: "birch",
    label: "Birch",
    color: "#E8DCC8",
    finish: "wood",
  },
  {
    id: "plywood",
    label: "Plywood",
    color: "#D4B896",
    finish: "wood",
  },
  {
    id: "white",
    label: "Painted white",
    color: "#F5F2ED",
    finish: "paint",
  },
  {
    id: "black",
    label: "Matte black",
    color: "#2A2A2A",
    finish: "paint",
  },
  {
    id: "terracotta",
    label: "Terracotta",
    color: "#c45a2c",
    finish: "paint",
  },
];

export const DEFAULT_PANEL_MATERIAL_ID = "terracotta";

export function getPanelMaterial(id: string | null | undefined): PanelMaterial {
  return (
    PANEL_MATERIALS.find((m) => m.id === id) ??
    PANEL_MATERIALS.find((m) => m.id === DEFAULT_PANEL_MATERIAL_ID)!
  );
}

export function resolveItemMaterial(item: {
  color: string;
  meta?: Record<string, unknown> | null;
}): PanelMaterial {
  const mid =
    typeof item.meta?.materialId === "string" ? item.meta.materialId : null;
  if (mid) return getPanelMaterial(mid);
  // Match by color when older items have no materialId.
  const byColor = PANEL_MATERIALS.find(
    (m) => m.color.toLowerCase() === item.color.toLowerCase(),
  );
  return byColor ?? getPanelMaterial(DEFAULT_PANEL_MATERIAL_ID);
}
