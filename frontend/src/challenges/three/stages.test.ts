import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { cube as cubeChallenge, FACELETS } from "../cube";
import { STAGES } from "./stages";

const HEX: Record<string, string> = { W: "f8fafc", Y: "facc15", G: "16a34a", B: "2563eb", R: "dc2626", O: "f97316" };

function build(data: unknown, replay: unknown) {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const ctx = { scene, camera: new THREE.PerspectiveCamera(), target: new THREE.Vector3(), root };
  return { stage: STAGES.cube!.create(ctx, data, replay), root };
}

/** colour of the sticker sitting at world position `p` (centre of a facelet) */
function stickerAt(root: THREE.Group, p: THREE.Vector3): string | null {
  root.updateMatrixWorld(true);
  let found: string | null = null;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!(m.geometry instanceof THREE.PlaneGeometry)) return;
    if (m.getWorldPosition(new THREE.Vector3()).distanceTo(p) < 0.05)
      found = (m.material as THREE.MeshStandardMaterial).color.getHexString();
  });
  return found;
}

describe("3D cube matches the facelet model the answers are graded with", () => {
  for (const [seed, level] of [
    [1, "easy"],
    [77, "medium"],
    [4242, "hard"],
  ] as const)
    it(`seed ${seed} ${level}: every sticker`, () => {
      const puzzle = cubeChallenge.generate(seed, level);
      const data = puzzle.data as { cube: string[]; scramble: string[] };
      const { stage, root } = build(data, undefined);
      stage.setStep(0, false);
      FACELETS.forEach(({ pos, normal }, i) => {
        const at = new THREE.Vector3(...pos).addScaledVector(new THREE.Vector3(...normal), 0.485);
        expect(stickerAt(root, at), `facelet ${i}`).toBe(HEX[data.cube[i]!]);
      });
    });

  it("replaying a solving answer ends solved, with animated and instant steps agreeing", async () => {
    const puzzle = cubeChallenge.generate(9, "medium");
    const data = puzzle.data as { scramble: string[] };
    const inverse = [...data.scramble].reverse().map((m) => (m.endsWith("'") ? m[0]! : m.endsWith("2") ? m : `${m}'`));
    const v = await puzzle.check(`<answer>${inverse.join(" ")}</answer>`);
    expect(v.solved).toBe(true);
    const { stage, root } = build(data, v.replay);
    for (let k = 1; k <= inverse.length; k++) {
      stage.setStep(k, true);
      stage.tick(5); // finish the turn
    }
    // no rebuild: the animated turns themselves must land on the solved cube
    FACELETS.forEach(({ pos, normal }) => {
      const at = new THREE.Vector3(...pos).addScaledVector(new THREE.Vector3(...normal), 0.485);
      const face = normal.join(",");
      const expected = { "0,1,0": "W", "0,-1,0": "Y", "0,0,1": "G", "0,0,-1": "B", "1,0,0": "R", "-1,0,0": "O" }[face]!;
      expect(stickerAt(root, at)).toBe(HEX[expected]);
    });
  });
});
