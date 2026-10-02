import type { CardPositionsSlice } from "./card-positions-slice";
import type { ChatSlice } from "./chat-slice";
import type { FurnitureSlice } from "./furniture-slice";
import type { GenerationsSlice } from "./generations-slice";
import type { HistorySlice } from "./history-slice";
import type { PersonaSlice } from "./persona-slice";
import type { PreferencesSlice } from "./preferences-slice";
import type { ProfileSlice } from "./profile-slice";
import type { ProjectsSlice } from "./projects-slice";
import type { RequirementsSlice } from "./requirements-slice";
import type { SceneSourceSlice } from "./scene-source-slice";
import type { SelectionSlice } from "./selection-slice";
import type { StarredSlice } from "./starred-slice";
import type { SuggestionsSlice } from "./suggestions-slice";
import type { TourSlice } from "./tour-slice";
import type { UiFlagsSlice } from "./ui-flags-slice";
import type { WallsSlice } from "./walls-slice";

export type Store = ChatSlice &
  UiFlagsSlice &
  ProjectsSlice &
  HistorySlice &
  CardPositionsSlice &
  FurnitureSlice &
  WallsSlice &
  SelectionSlice &
  TourSlice &
  RequirementsSlice &
  GenerationsSlice &
  SceneSourceSlice &
  PreferencesSlice &
  SuggestionsSlice &
  StarredSlice &
  ProfileSlice &
  PersonaSlice;
