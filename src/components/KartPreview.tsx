"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { buildKart, disposeRig, type KartRig } from "@/game/karts";
import { KART_PRESETS, type Profile } from "@/game/types";
import { getPaintSkin } from "@/game/cosmetics";

export default function KartPreview({ profile }: { profile: Profile }) {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rigRef = useRef<KartRig | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(5.7, 3.6, 6.9);
    camera.lookAt(0, 0.68, 0);
    scene.add(new THREE.HemisphereLight(0xaac0ff, 0x402060, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(4, 8, 5);
    key.castShadow = true;
    scene.add(key);
    const rim = new THREE.PointLight(0xff3fb0, 40, 20);
    rim.position.set(-5, 2, -4);
    scene.add(rim);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.3, 40), new THREE.MeshStandardMaterial({ color: 0x14172b, roughness: 0.5, metalness: 0.6 }));
    ped.position.y = -0.15;
    ped.receiveShadow = true;
    scene.add(ped);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.05, 6, 64), new THREE.MeshBasicMaterial({ color: 0x35e8ff }));
    ring.rotation.x = Math.PI / 2;
    scene.add(ring);

    const resize = () => {
      const w = el.clientWidth || 300;
      const h = el.clientHeight || 300;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (rigRef.current) {
        rigRef.current.group.rotation.y += dt * 0.7;
        rigRef.current.spinners.forEach((s) => (s.rotation.x += dt * 4));
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (rigRef.current) disposeRig(rigRef.current);
      rigRef.current = null;
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const preset = KART_PRESETS[profile.kartId] ?? KART_PRESETS[0];
    const paint = getPaintSkin(profile.paintId);
    let rot = 0.6;
    if (rigRef.current) {
      rot = rigRef.current.group.rotation.y;
      scene.remove(rigRef.current.group);
      disposeRig(rigRef.current);
    }
    const rig = buildKart(preset, {
      primary: paint.primary ?? undefined,
      accent: paint.accent ?? undefined,
      glow: profile.glow,
      avatar: profile.avatar,
      wheelStyle: profile.wheelStyle,
    });
    rig.group.rotation.y = rot;
    rig.group.scale.setScalar(0.9);
    rig.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    scene.add(rig.group);
    rigRef.current = rig;
  }, [profile.kartId, profile.glow, profile.avatar, profile.paintId, profile.wheelStyle]);

  return <div ref={ref} className="h-full w-full" />;
}
