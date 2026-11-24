"use client";

import { useState } from "react";
import { AVATARS, GLOW_SWATCHES, KART_PRESETS, type Profile } from "@/game/types";
import { buyCosmetic, getPaintSkin, getWheelStyle, PAINT_SKINS, WHEEL_STYLES } from "@/game/cosmetics";
import KartPreview from "./KartPreview";

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

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
      <div className="mx-auto mt-4 grid w-full max-w-6xl flex-1 gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="kw-panel relative h-[260px] self-start overflow-hidden sm:h-[320px] lg:h-[380px]">
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
                  aria-pressed={profile.kartId === k.id}
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
