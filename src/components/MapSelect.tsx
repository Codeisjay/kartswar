"use client";

import { useState } from "react";
import Image from "next/image";
import { MAPS } from "@/game/maps";

const DIFF_COLOR: Record<string, string> = {
  Easy: "#6dff6d",
  Medium: "#ffd21f",
  Spicy: "#ff5a3a",
};

export default function MapSelect({
  onPick,
  onBack,
}: {
  onPick: (mapId: string) => void;
  onBack: () => void;
}) {
  const [sel, setSel] = useState<string>("random");
  return (
    <div className="absolute inset-0 z-10 flex flex-col overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
        <h2 className="kw-display kw-title text-5xl">Select Map</h2>
        <button className="kw-btn ghost small" onClick={onBack}>
          <span>← Back</span>
        </button>
      </div>
      <div className="mx-auto mt-6 grid w-full max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <button
          onClick={() => setSel("random")}
          className={`kw-panel group overflow-hidden p-0 text-left transition-transform hover:-translate-y-1 ${
            sel === "random" ? "ring-2 ring-cyan-300" : ""
          }`}
          style={sel === "random" ? { boxShadow: "0 0 30px rgba(53,232,255,0.45)" } : undefined}
        >
          <div className="kw-bg relative h-40">
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="kw-display text-7xl text-white transition-transform group-hover:rotate-180" style={{ transition: "transform 0.6s" }}>
                🎲
              </span>
            </div>
            {sel === "random" && (
              <div className="kw-display absolute right-2 top-2 rounded-full bg-cyan-300 px-3 py-0.5 text-sm text-black">
                ✓ SELECTED
              </div>
            )}
          </div>
          <div className="p-4">
            <div className="kw-display text-2xl text-white">Random Map</div>
            <p className="mt-1 text-sm text-slate-300">Let fate decide. A random arena every match.</p>
          </div>
        </button>
        {MAPS.map((m) => (
          <button
            key={m.id}
            onClick={() => setSel(m.id)}
            className={`kw-panel group overflow-hidden p-0 text-left transition-transform hover:-translate-y-1 ${
              sel === m.id ? "ring-2 ring-cyan-300" : ""
            }`}
            style={sel === m.id ? { boxShadow: "0 0 30px rgba(53,232,255,0.45)" } : undefined}
          >
            <div className="relative h-40 overflow-hidden bg-black transition-transform duration-300 group-hover:scale-[1.02]">
              <Image src={m.image} alt={`${m.name} map preview`} fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" className="object-cover" />
              {sel === m.id && (
                <div className="kw-display absolute right-2 top-2 rounded-full bg-cyan-300 px-3 py-0.5 text-sm text-black">
                  ✓ SELECTED
                </div>
              )}
              <div
                className="kw-display absolute left-2 top-2 rounded-full px-3 py-0.5 text-sm text-black"
                style={{ background: DIFF_COLOR[m.difficulty] }}
              >
                {m.difficulty}
              </div>
            </div>
            <div className="p-4">
              <div className="kw-display text-2xl text-white">{m.name}</div>
              <div className="text-xs uppercase tracking-widest text-cyan-300">{m.tagline}</div>
              <p className="mt-1 text-sm text-slate-300">{m.desc}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.traits.map((t) => (
                  <span key={t} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-slate-200">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </button>
        ))}
      </div>
      <div className="mx-auto mt-6 w-full max-w-6xl pb-6 text-center">
        <button className="kw-btn px-10 text-2xl" onClick={() => onPick(sel)}>
          <span>▶ Start Battle</span>
        </button>
      </div>
    </div>
  );
}
