"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { buildKart, disposeRig, type KartRig } from "@/game/karts";
import { AVATARS, GLOW_SWATCHES, KART_PRESETS, type Profile } from "@/game/types";
import { buyCosmetic, getPaintSkin, getWheelStyle, PAINT_SKINS, WHEEL_STYLES } from "@/game/cosmetics";

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

function KartPreview({ profile }: { profile: Profile }) {
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
    camera.position.set(5.2, 3.2, 6.2);
    camera.lookAt(0, 0.7, 0);
    scene.add(new THREE.HemisphereLight(0xaac0ff, 0x402060, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(4, 8, 5);
    key.castShadow = true;
    scene.add(key);
    const rim = new THREE.PointLight(0xff3fb0, 40, 20);
    rim.position.set(-5, 2, -4);
    scene.add(rim);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.3, 40), new THREE.MeshStandardMaterial({ color: 0x14172b, roughness: 0.5, metalness: 0.6 }));
    ped.position.y = -0.15;
    ped.receiveShadow = true;
    scene.add(ped);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.05, 6, 64), new THREE.MeshBasicMaterial({ color: 0x35e8ff }));
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
    rig.group.scale.setScalar(1.15);
    rig.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    scene.add(rig.group);
    rigRef.current = rig;
  }, [profile.kartId, profile.glow, profile.avatar, profile.paintId, profile.wheelStyle]);

  return <div ref={ref} className="h-full w-full" />;
}

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(8, Math.min(100, ((value - 0.8) / 0.4) * 100));
  return (
    <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-slate-300">
      <span className="w-16">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-pink-400" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function KartSelect({ profile, onChange, onBack }: { profile: Profile; onChange: (p: Profile) => void; onBack: () => void }) {
  const [shopMessage, setShopMessage] = useState("");
  const preset = KART_PRESETS[profile.kartId] ?? KART_PRESETS[0];
  const buyOrEquip = (id: string, owned: boolean, type: "paint" | "wheel") => {
    if (owned) {
      onChange(type === "paint" ? { ...profile, paintId: id } : { ...profile, wheelStyle: id });
      setShopMessage("");
      return;
    }
    const updated = buyCosmetic(profile, id);
    if (!updated) {
      setShopMessage("Not enough credits for that cosmetic.");
      return;
    }
    onChange(updated);
    setShopMessage("Cosmetic unlocked and equipped!");
  };
  return (
    <div className="absolute inset-0 z-10 flex flex-col overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
        <h2 className="kw-display kw-title text-5xl">Garage</h2>
        <button className="kw-btn ghost small" onClick={onBack}>
          <span>← Back</span>
        </button>
      </div>
      <div className="mx-auto mt-4 grid w-full max-w-6xl flex-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="kw-panel relative min-h-[320px] overflow-hidden">
          <KartPreview profile={profile} />
          <div className="pointer-events-none absolute bottom-4 left-5">
            <div className="kw-display text-4xl text-white">{preset.name}</div>
            <div className="text-sm text-slate-300">{preset.tagline} · {getPaintSkin(profile.paintId).name} · {getWheelStyle(profile.wheelStyle).name}</div>
          </div>
          <div className="absolute right-4 top-4 w-44 space-y-1.5 rounded-lg bg-black/40 p-3">
            <Bar label="Speed" value={preset.speed} />
            <Bar label="Handling" value={preset.handling} />
            <Bar label="Armor" value={preset.armor} />
          </div>
        </div>
        <div className="space-y-4">
          <div className="kw-panel p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-slate-400">Credits</div>
                <div className="kw-display text-3xl text-yellow-200">{profile.credits.toLocaleString()} <span className="text-xl">🪙</span></div>
              </div>
              <div className="max-w-40 text-right text-xs text-slate-400">Earn credits by scoring. Wallet is saved in this browser.</div>
            </div>
            {shopMessage && <div role="status" className="mt-2 text-xs text-cyan-200">{shopMessage}</div>}
          </div>
          <div className="kw-panel p-4">
            <div className="mb-2 text-xs uppercase tracking-widest text-slate-400">Choose kart</div>
            <div className="grid grid-cols-3 gap-2">
              {KART_PRESETS.map((k) => (
                <button
                  key={k.id}
                  className={`kw-chip p-2 text-left ${profile.kartId === k.id ? "active" : ""}`}
                  onClick={() => onChange({ ...profile, kartId: k.id, glow: k.glow })}
                >
                  <div className="mb-1 flex gap-1">
                    <span className="h-3 w-6 rounded-sm" style={{ background: hex(k.primary) }} />
                    <span className="h-3 w-3 rounded-sm" style={{ background: hex(k.accent) }} />
                  </div>
                  <div className="kw-display text-sm leading-tight">{k.name}</div>
                  <div className="text-[10px] uppercase text-slate-400">{k.shape}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="kw-panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs uppercase tracking-widest text-slate-400">Paint shop</div>
              <span className="text-xs text-slate-500">Visual only</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {PAINT_SKINS.map((skin) => {
                const owned = profile.ownedPaints.includes(skin.id);
                const equipped = profile.paintId === skin.id;
                return (
                  <div key={skin.id} className="rounded-lg border border-white/10 bg-black/20 p-2">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="h-5 w-8 rounded" style={{ background: hex(skin.primary ?? preset.primary) }} />
                      <span className="h-5 w-5 rounded" style={{ background: hex(skin.accent ?? preset.accent) }} />
                      <span className="truncate text-xs font-bold">{skin.name}</span>
                    </div>
                    <button
                      className="kw-chip w-full py-1 text-xs"
                      disabled={equipped || (!owned && profile.credits < skin.price)}
                      onClick={() => buyOrEquip(skin.id, owned, "paint")}
                    >
                      {equipped ? "Equipped" : owned ? "Equip" : `Unlock · ${skin.price} 🪙`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="kw-panel p-4">
            <div className="mb-2 text-xs uppercase tracking-widest text-slate-400">Wheel finishes</div>
            <div className="grid grid-cols-2 gap-2">
              {WHEEL_STYLES.map((style) => {
                const owned = profile.ownedWheelStyles.includes(style.id);
                const equipped = profile.wheelStyle === style.id;
                return (
                  <div key={style.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-2">
                    <span
                      className="h-6 w-6 shrink-0 rounded-full border-4 border-slate-800"
                      style={{ background: hex(style.rimColor ?? preset.accent) }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold">{style.name}</div>
                      <button
                        className="kw-chip mt-1 w-full py-1 text-xs"
                        disabled={equipped || (!owned && profile.credits < style.price)}
                        onClick={() => buyOrEquip(style.id, owned, "wheel")}
                      >
                        {equipped ? "Equipped" : owned ? "Equip" : `Unlock · ${style.price} 🪙`}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="kw-panel p-4">
            <div className="mb-2 text-xs uppercase tracking-widest text-slate-400">Underglow</div>
            <div className="flex flex-wrap gap-2">
              {GLOW_SWATCHES.map((g) => (
                <button
                  key={g}
                  aria-label={`glow ${hex(g)}`}
                  className={`h-9 w-9 rounded-full border-2 transition-transform hover:scale-110 ${profile.glow === g ? "border-white" : "border-transparent"}`}
                  style={{ background: hex(g), boxShadow: `0 0 14px ${hex(g)}` }}
                  onClick={() => onChange({ ...profile, glow: g })}
                />
              ))}
            </div>
          </div>
          <div className="kw-panel p-4">
            <div className="mb-1 text-xs uppercase tracking-widest text-slate-400">Driver character</div>
            <div className="text-xs text-slate-500">Choose the 3D racer style for your kart.</div>
            <input
              value={profile.name}
              maxLength={14}
              onChange={(e) => onChange({ ...profile, name: e.target.value })}
              className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-lg font-bold outline-none focus:border-cyan-300"
              placeholder="Your name"
            />
            <div className="mt-3 grid grid-cols-6 gap-2">
              {AVATARS.map((a) => (
                <button key={a} aria-label={`Select ${a} driver`} className={`kw-chip py-1.5 text-2xl ${profile.avatar === a ? "active" : ""}`} onClick={() => onChange({ ...profile, avatar: a })}>
                  {a}
                </button>
              ))}
            </div>
          </div>
          <button className="kw-btn w-full" onClick={onBack}>
            <span>✔ Save &amp; Back</span>
          </button>
        </div>
      </div>
    </div>
  );
}
