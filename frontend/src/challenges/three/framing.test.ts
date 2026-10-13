import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";

import { challengeById } from "../index";
import { fitCamera } from "./stage";
import { STAGES } from "./stages";

// jsdom has no 2D canvas: a tiny stand-in is enough for text sprites
beforeAll(() => {
  const ctx2d = {
    measureText: (s: string) => ({ width: s.length * 30 }),
    fillRect() {},
    fillText() {},
    beginPath() {},
    roundRect() {},
    fill() {},
  };
  HTMLCanvasElement.prototype.getContext = (() => ctx2d) as never;
});

/** fraction of the view the scene's bounding box covers, and whether any corner falls outside */
function framing(id: string, aspect: number) {
  const c = challengeById(id)!;
  const puzzle = c.generate(5, "medium");
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 200);
  const target = new THREE.Vector3();
  const stage = STAGES[id]!.create({ scene, camera, target, root }, puzzle.data, undefined);
  stage.setStep(0, false);
  camera.updateProjectionMatrix();
  fitCamera(camera, target, root); // what Board3D does on mount / resize
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  root.updateMatrixWorld(true);
  // meshes only (sprites have their own scale semantics)
  const box = new THREE.Box3();
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.visible) box.expandByObject(o);
  });
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    behind = false;
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(x, y, z).project(camera);
        if (p.z > 1) behind = true;
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
  return { empty: box.isEmpty(), behind, minX, maxX, minY, maxY, cover: Math.max((maxX - minX) / 2, (maxY - minY) / 2) };
}

describe("every 3D board frames its puzzle", () => {
  for (const id of Object.keys(STAGES))
    for (const aspect of [1.4, 2.6])
      // narrow (2-column) and wide cards
      it(`${id} @ aspect ${aspect}`, () => {
        const f = framing(id, aspect);
        expect(f.empty, "nothing in the scene").toBe(false);
        expect(f.behind).toBe(false);
        // fully inside the view (small margin for bounding-box slack)
        expect(f.minX, "cropped left").toBeGreaterThan(-1.05);
        expect(f.maxX, "cropped right").toBeLessThan(1.05);
        expect(f.minY, "cropped bottom").toBeGreaterThan(-1.05);
        expect(f.maxY, "cropped top").toBeLessThan(1.05);
        // and not lost in the distance
        expect(f.cover, "too small").toBeGreaterThan(0.45);
      });
});
