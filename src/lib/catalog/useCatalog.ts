import { useEffect, useState } from "react";
import type { CatalogIndex, CatalogItem } from "./types";

/**
 * Fetches the catalog index JSON from `/catalog/index.json` and
 * caches it across the app so multiple tool cards mounting at the
 * same time don't fire duplicate requests. The first hook call
 * fires the fetch; every subsequent call returns the cached copy.
 *
 * Returns `{ items, loading, error }`. `items` is empty until the
 * fetch resolves, which the consumer should render as a tiny
 * loading state. The fetch is stable across hot-reload because the
 * cache lives in module scope.
 */

let cached: CatalogIndex | null = null;
let inflight: Promise<CatalogIndex> | null = null;

export async function fetchCatalog(): Promise<CatalogIndex> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = fetch("/studio/catalog/index.json")
    .then((res) => {
      if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
      return res.json() as Promise<CatalogIndex>;
    })
    .then((data) => {
      cached = data;
      inflight = null;
      return data;
    })
    .catch((e) => {
      inflight = null;
      throw e;
    });
  return inflight;
}

interface CatalogState {
  items: CatalogItem[];
  loading: boolean;
  error: string | null;
}

export function useCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>(() => ({
    items: cached?.items ?? [],
    loading: !cached,
    error: null,
  }));

  useEffect(() => {
    if (cached) return;
    let alive = true;
    fetchCatalog()
      .then((data) => {
        if (!alive) return;
        setState({ items: data.items, loading: false, error: null });
      })
      .catch((err) => {
        if (!alive) return;
        setState({
          items: [],
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
