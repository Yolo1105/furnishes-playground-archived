/**
 * One entry in `public/catalog/index.json`. Mirrors the schema used
 * by the zip's V4 catalog, restricted to the fields the Catalog
 * browser + GLB seeding pipeline actually need:
 *
 *   • `id`         — stable identifier
 *   • `label`      — human display name
 *   • `category`   — bucket (bathroom / bedroom / decor / …)
 *   • `shape`      — short shape descriptor used by the catalog
 *                    panel for an emoji-free shape hint
 *   • dimensions   — width / depth / height in metres; shown as
 *                    a compact "W × D × H" subtitle on each card
 *   • `nodeNames`  — names of the matching meshes inside the
 *                    apartamento.glb scene graph. Used by the
 *                    Apartment component to seed the inventory at
 *                    load: each catalog entry whose nodeNames are
 *                    present in the GLB is registered as a
 *                    PlacedItem with mesh refs, so eye-toggle and
 *                    trash actually affect what the user sees.
 */
export interface CatalogItem {
  id: string;
  label: string;
  category: string;
  shape: string;
  width: number;
  depth: number;
  height: number;
  nodeNames: string[];
}

export interface CatalogIndex {
  version: string;
  items: CatalogItem[];
}
