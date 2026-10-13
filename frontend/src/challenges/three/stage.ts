import * as THREE from "three";

/** One challenge scene. `setStep(k)` shows the board after k steps of the model's answer. */
export interface Stage {
  setStep: (k: number, animate: boolean) => void;
  /** per frame; dt in seconds */
  tick: (dt: number) => void;
  dispose?: () => void;
}

export interface StageCtx {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** orbit target */
  target: THREE.Vector3;
  root: THREE.Group;
}

export interface StageDef {
  create: (ctx: StageCtx, data: unknown, replay: unknown) => Stage;
}

export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Text sprite (canvas texture). Width in world units; height follows the text. */
export function label(text: string, opts: { size?: number; color?: string; bg?: string; bold?: boolean } = {}): THREE.Sprite {
  const px = 64;
  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d")!;
  const font = `${opts.bold ? "600 " : ""}${px}px ui-sans-serif, system-ui, sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + (opts.bg ? px * 0.6 : 8);
  canvas.width = w;
  canvas.height = px * 1.4;
  if (opts.bg) {
    g.fillStyle = opts.bg;
    g.beginPath();
    g.roundRect(0, 0, canvas.width, canvas.height, px * 0.35);
    g.fill();
  }
  g.font = font;
  g.fillStyle = opts.color ?? "#e2e8f0";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const size = opts.size ?? 0.5;
  sprite.scale.set((size * canvas.width) / canvas.height, size, 1);
  return sprite;
}

/** Square canvas texture with a centred glyph (tile faces). */
export function glyphTexture(text: string, fg: string, bg: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = fg;
  g.font = "600 76px ui-sans-serif, system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Free GPU memory of everything under `obj`. */
export function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
}

/**
 * Keep the stage's viewing direction, but move the camera so the whole scene fits the
 * view at the current aspect ratio (with `margin` of the frame to spare).
 */
export function fitCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3, root: THREE.Object3D, margin = 0.88) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.visible) box.expandByObject(o);
  });
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const dir = camera.position.clone().sub(target).normalize();
  if (dir.lengthSq() === 0) dir.set(0, 0.6, 0.8).normalize();
  const corners = [box.min.x, box.max.x].flatMap((x) =>
    [box.min.y, box.max.y].flatMap((y) => [box.min.z, box.max.z].map((z) => new THREE.Vector3(x, y, z))),
  );
  const fits = (d: number) => {
    camera.position.copy(center).addScaledVector(dir, d);
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    return corners.every((c) => {
      const p = c.clone().project(camera);
      return p.z < 1 && Math.abs(p.x) <= margin && Math.abs(p.y) <= margin;
    });
  };
  let lo = 0.5;
  let hi = 200;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  fits(hi);
  target.copy(center);
}

export function placeCamera(ctx: StageCtx, at: [number, number, number], target: [number, number, number] = [0, 0, 0]) {
  ctx.camera.position.set(...at);
  ctx.target.set(...target);
  ctx.camera.lookAt(ctx.target);
}

export { THREE };
