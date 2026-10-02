"use client";

import { Grid } from "@react-three/drei";
import * as THREE from "three";

/**
 * Warm brown floor grid for the panel stage.
 *
 * Small visible patch with a soft outer fade. Fade is measured from
 * the camera’s projection on the floor (`fadeFrom={1}`), so panning /
 * orbiting slides the lit area and reveals more cells — not a static
 * disc glued to the world origin.
 */
export function PanelStageGround() {
  return (
    <group name="panel-stage-ground">
      <Grid
        position={[0, -0.001, 0]}
        args={[40, 40]}
        cellSize={0.25}
        cellThickness={1.0}
        cellColor="#c9a57a"
        sectionSize={1}
        sectionThickness={1.35}
        sectionColor="#a67a4e"
        // Compact lit radius; stronger power → clearer edge fade-out.
        fadeDistance={7}
        fadeStrength={1.75}
        fadeFrom={1}
        infiniteGrid
        followCamera
        side={THREE.DoubleSide}
      />
    </group>
  );
}
