import { describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  migrateSnapshot,
} from "./snapshot";

const CURRENT = "3.5.0";

function baseFields() {
  return {
    id: "proj_test",
    name: "Test space",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_100,
    items: [{ id: "chair_1", x: 1, z: 2, rotation: 90, placed: true, visible: true, locked: false }],
    generations: {
      candidates: [],
      appliedIndex: null,
      inspectIndex: null,
      history: [],
    },
    requirements: {
      presetName: null,
      mustInclude: {},
      optionalInclude: {},
      walkwayMinCm: 75,
      doorClearance: true,
      windowAccess: false,
      bedAgainstWall: "prefer",
      flowVsStorage: 0.5,
      opennessVsCozy: 0.5,
    },
  };
}

describe("migrateSnapshot", () => {
  it("rejects non-objects", () => {
    expect(() => migrateSnapshot(null)).toThrow(/not an object/);
    expect(() => migrateSnapshot("snapshot")).toThrow(/not an object/);
  });

  it("treats a missing schemaVersion as 1.0 viewer data", () => {
    const migrated = migrateSnapshot({
      ...baseFields(),
      conversation: [
        { id: 11, userText: "hello", response: "hi", displayTime: "1:00" },
      ],
    });

    expect(migrated.schemaVersion).toBe(CURRENT);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.sceneSource).toBe("viewer");
    expect(migrated.furnitureFull).toEqual([]);
    expect(migrated.roomMeta).toBeNull();
    expect(migrated.walls).toEqual([]);
    expect(migrated.openings).toEqual([]);
    expect(migrated.styleBible).toBeNull();
    expect(migrated.originalScene).toBeNull();
    expect(migrated.referenceImageUrl).toBeNull();
    expect(migrated.preferences).toEqual([]);
    expect(migrated.profile).toBeNull();
    expect(migrated.generations.assetGenerations).toEqual([]);
    expect(migrated.conversations).toHaveLength(1);
    expect(migrated.conversations[0]?.title).toBe("Conversation 1");
    expect(migrated.conversations[0]?.turns).toHaveLength(1);
    expect(migrated.activeConversationId).toBe(migrated.conversations[0]?.id);
    expect(migrated.items).toHaveLength(1);
  });

  it("wraps a 3.1.0 single conversation array", () => {
    const migrated = migrateSnapshot({
      ...baseFields(),
      schemaVersion: "3.1.0",
      sceneSource: "viewer",
      furnitureFull: [],
      roomMeta: null,
      walls: [],
      openings: [],
      styleBible: null,
      originalScene: null,
      conversation: [
        { id: 21, userText: "move the sofa", response: "ok", displayTime: "2:00" },
      ],
    });

    expect(migrated.schemaVersion).toBe(CURRENT);
    expect(migrated.conversations).toHaveLength(1);
    expect(migrated.conversations[0]?.turns[0]?.userText).toBe("move the sofa");
    expect(migrated.preferences).toEqual([]);
    expect(migrated.profile).toBeNull();
    expect(migrated.generations.assetGenerations).toEqual([]);
  });

  it("adds empty preferences on 3.2.0", () => {
    const migrated = migrateSnapshot({
      ...baseFields(),
      schemaVersion: "3.2.0",
      sceneSource: "viewer",
      furnitureFull: [],
      conversations: [],
      activeConversationId: null,
    });

    expect(migrated.schemaVersion).toBe(CURRENT);
    expect(migrated.preferences).toEqual([]);
    expect(migrated.profile).toBeNull();
  });

  it("keeps 3.3.0 preferences and nulls profile", () => {
    const prefs = [
      {
        id: "pref_1",
        projectId: "proj_test",
        key: "palette",
        value: "warm",
        source: "extracted",
      },
    ];
    const migrated = migrateSnapshot({
      ...baseFields(),
      schemaVersion: "3.3.0",
      sceneSource: "viewer",
      furnitureFull: [],
      conversations: [],
      activeConversationId: null,
      preferences: prefs,
    });

    expect(migrated.schemaVersion).toBe(CURRENT);
    expect(migrated.preferences).toEqual(prefs);
    expect(migrated.profile).toBeNull();
  });

  it("preserves a 3.4.0 profile when present", () => {
    const profile = { kind: "sg-hdb" as const, flatType: "4-room", room: "living" };
    const migrated = migrateSnapshot({
      ...baseFields(),
      schemaVersion: "3.4.0",
      sceneSource: "viewer",
      furnitureFull: [],
      conversations: [],
      activeConversationId: null,
      preferences: [],
      profile,
    });

    expect(migrated.schemaVersion).toBe(CURRENT);
    expect(migrated.profile).toEqual(profile);
  });

  it("defaults a missing 3.4.0 profile to null", () => {
    const migrated = migrateSnapshot({
      ...baseFields(),
      schemaVersion: "3.4.0",
      sceneSource: "room-director",
      furnitureFull: [{ id: "sofa", label: "Sofa" }],
    });

    expect(migrated.schemaVersion).toBe(CURRENT);
    expect(migrated.profile).toBeNull();
    expect(migrated.sceneSource).toBe("room-director");
  });

  it("passes through the current schema with defensive defaults", () => {
    const migrated = migrateSnapshot({
      ...baseFields(),
      schemaVersion: CURRENT,
      sceneSource: "viewer",
    });

    expect(migrated.schemaVersion).toBe(CURRENT);
    expect(migrated.furnitureFull).toEqual([]);
    expect(migrated.conversations).toEqual([]);
    expect(migrated.preferences).toEqual([]);
    expect(migrated.profile).toBeNull();
    expect(migrated.generations.assetGenerations).toEqual([]);
  });

  it("leaves an empty legacy conversation list empty", () => {
    const migrated = migrateSnapshot({
      ...baseFields(),
      conversation: [],
    });

    expect(migrated.conversations).toEqual([]);
    expect(migrated.activeConversationId).toBeNull();
  });
});
