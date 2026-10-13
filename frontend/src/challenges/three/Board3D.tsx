/**
 * WebGL board for one model's copy of a challenge. Lazy-loaded (three.js stays out of the main bundle).
 * Renders only while on screen, and releases its WebGL context when scrolled far away,
 * so a long battle with many boards never runs out of contexts.
 *
 * The renderer lives as long as the board is visible; the *stage* (scene content) is rebuilt
 * whenever the replay changes — cheap, so live attempts can swap in many times per answer.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { STAGES } from "./stages";
import { disposeTree, fitCamera, type Stage } from "./stage";

interface Runtime {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  target: THREE.Vector3;
  root: THREE.Group;
  stage: Stage | null;
  spin: boolean;
  fitted: boolean;
  /** fit the camera to the current stage (first stage, and on resize) */
  refit: () => void;
}

export default function Board3D({
  id,
  data,
  replay,
  step,
  spin = false,
  height = 240,
}: {
  id: string;
  data: unknown;
  replay: unknown;
  step: number;
  /** slow turntable while the model is thinking */
  spin?: boolean;
  height?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const rt = useRef<Runtime | null>(null);
  const shown = useRef(0);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(0);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // renderer, camera, lights, controls — one per visible board
  useEffect(() => {
    const el = host.current;
    if (!el || !visible) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    const root = new THREE.Group();
    scene.add(root);
    scene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(4, 8, 6);
    scene.add(sun);
    const target = new THREE.Vector3();
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false; // keep the page scroll wheel
    controls.enablePan = false;
    controls.enableDamping = true;

    const runtime: Runtime = {
      scene,
      camera,
      controls,
      target,
      root,
      stage: null,
      spin: false,
      fitted: false,
      refit: () => {
        fitCamera(camera, target, root, 0.8);
        controls.target.copy(target);
        controls.update();
      },
    };
    rt.current = runtime;

    const resize = () => {
      const w = el.clientWidth || 300;
      renderer.setSize(w, height);
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
      if (runtime.stage) runtime.refit();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let last = performance.now();
    renderer.setAnimationLoop((now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      runtime.stage?.tick(dt);
      if (runtime.spin) root.rotation.y += dt * 0.35;
      else if (root.rotation.y !== 0) {
        // ease back to the front view (shortest way round) — snapping makes the cube look like it changed colour
        const off = Math.atan2(Math.sin(root.rotation.y), Math.cos(root.rotation.y));
        root.rotation.y = Math.abs(off) < 0.002 ? 0 : off * Math.max(0, 1 - dt * 4);
      }
      controls.update();
      renderer.render(scene, camera);
    });
    setReady((n) => n + 1);

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      runtime.stage?.dispose?.();
      disposeTree(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      rt.current = null;
    };
  }, [visible, height]);

  // scene content: rebuilt for every new replay (final answer or a live attempt)
  useEffect(() => {
    const r = rt.current;
    const def = STAGES[id];
    if (!r || !def) return;
    r.stage?.dispose?.();
    for (const child of [...r.root.children]) {
      r.root.remove(child);
      disposeTree(child);
    }
    // keep the current turntable angle: rebuilding the scene must not visibly jump
    // stages place the camera to choose a viewing direction; keep the user's angle after the first fit
    const saved = r.fitted ? { pos: r.camera.position.clone(), target: r.target.clone() } : null;
    r.stage = def.create({ scene: r.scene, camera: r.camera, target: r.target, root: r.root }, data, replay);
    r.stage.setStep(Math.min(shown.current, step), false);
    shown.current = Math.min(shown.current, step);
    if (saved) {
      r.camera.position.copy(saved.pos);
      r.target.copy(saved.target);
      r.controls.target.copy(saved.target);
      r.controls.update();
    } else {
      r.refit();
      r.fitted = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `step` is applied by the effect below
  }, [id, data, replay, ready]);

  useEffect(() => {
    const s = rt.current?.stage;
    if (!s) {
      shown.current = step;
      return;
    }
    s.setStep(step, step === shown.current + 1);
    shown.current = step;
  }, [step, ready, replay]);

  useEffect(() => {
    if (rt.current) rt.current.spin = spin;
    // (stopping the spin eases back in the render loop instead of snapping)
  }, [spin, ready]);

  return (
    <div
      ref={host}
      className="w-full cursor-grab overflow-hidden rounded-md bg-gradient-to-b from-slate-900 to-slate-950 active:cursor-grabbing"
      style={{ height }}
    />
  );
}
