import { create } from "zustand";
import {
  createChatSlice,
  selectCanSend,
  selectAllKeywordsFilled,
} from "./chat-slice";
import { createUiFlagsSlice } from "./ui-flags-slice";
import {
  createProjectsSlice,
  selectCurrentProject,
} from "./projects-slice";
import { createHistorySlice } from "./history-slice";
import { createCardPositionsSlice } from "./card-positions-slice";
import {
  createFurnitureSlice,
  selectVisibleCount,
  selectPlaced,
  selectPlacedIds,
} from "./furniture-slice";
import { createWallsSlice } from "./walls-slice";
import { createSelectionSlice } from "./selection-slice";
import { createTourSlice } from "./tour-slice";
import { createRequirementsSlice } from "./requirements-slice";
import { createGenerationsSlice } from "./generations-slice";
import { createSceneSourceSlice } from "./scene-source-slice";
import { createPreferencesSlice } from "./preferences-slice";
import { createSuggestionsSlice } from "./suggestions-slice";
import { createStarredSlice } from "./starred-slice";
import { createProfileSlice } from "./profile-slice";
import { createPersonaSlice } from "./persona-slice";
import type { Store } from "./store-types";

export type { Store } from "./store-types";

export const useStore = create<Store>()((set, get, api) => ({
  ...createChatSlice(set, get, api),
  ...createUiFlagsSlice(set, get, api),
  ...createProjectsSlice(set, get, api),
  ...createHistorySlice(set, get, api),
  ...createCardPositionsSlice(set, get, api),
  ...createFurnitureSlice(set, get, api),
  ...createWallsSlice(set, get, api),
  ...createSelectionSlice(set, get, api),
  ...createTourSlice(set, get, api),
  ...createRequirementsSlice(set, get, api),
  ...createGenerationsSlice(set, get, api),
  ...createSceneSourceSlice(set, get, api),
  ...createPreferencesSlice(set, get, api),
  ...createSuggestionsSlice(set, get, api),
  ...createStarredSlice(set, get, api),
  ...createProfileSlice(set, get, api),
  ...createPersonaSlice(set, get, api),
}));

export {
  selectCanSend,
  selectAllKeywordsFilled,
  selectCurrentProject,
  selectVisibleCount,
  selectPlaced,
  selectPlacedIds,
};

export {
  selectProjectPreferences,
  selectPendingPreferences,
  selectConfirmedPreferences,
} from "./preferences-slice";
