"use client";

import type { Difficulty, Quality, Settings } from "@/game/types";

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="flex justify-between text-xs uppercase tracking-widest text-slate-300">
        <span>{label}</span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full" />
    </label>
  );
}

function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-left hover:bg-white/5" onClick={() => onChange(!value)}>
      <span>
        <span className="text-sm font-bold">{label}</span>
        {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
      </span>
      <span className={`relative h-6 w-11 rounded-full transition-colors ${value ? "bg-cyan-400" : "bg-white/20"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${value ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-widest text-slate-300">{label}</div>
      <div className="flex gap-1.5">
        {options.map((o) => (
          <button key={String(o.v)} className={`kw-chip flex-1 py-1.5 text-sm font-bold ${value === o.v ? "active" : ""}`} onClick={() => onChange(o.v)}>
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPanel({ settings, touch, onReplayTutorial, onChange, onBack }: { settings: Settings; touch: boolean; onReplayTutorial: () => void; onChange: (s: Settings) => void; onBack: () => void }) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  return (
    <div className="absolute inset-0 z-10 flex flex-col overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between">
        <h2 className="kw-display kw-title text-5xl">Settings</h2>
        <button className="kw-btn ghost small" onClick={onBack}>
          <span>← Back</span>
        </button>
      </div>
      <div className="mx-auto mt-4 grid w-full max-w-4xl gap-5 md:grid-cols-2">
        <div className="kw-panel space-y-4 p-5">
          <h3 className="kw-display text-xl text-cyan-300">Audio</h3>
          <Slider label="Master" value={settings.master} onChange={(v) => set("master", v)} />
          <Slider label="Music" value={settings.music} onChange={(v) => set("music", v)} />
          <Slider label="Sound effects" value={settings.sfx} onChange={(v) => set("sfx", v)} />
          <h3 className="kw-display pt-2 text-xl text-cyan-300">Gameplay</h3>
          <Seg<3 | 4 | 5> label="Match length" value={settings.matchMinutes} options={[{ v: 3, l: "3 min" }, { v: 4, l: "4 min" }, { v: 5, l: "5 min" }]} onChange={(v) => set("matchMinutes", v)} />
          <Seg<Difficulty> label="AI difficulty" value={settings.difficulty} options={[{ v: "easy", l: "Easy" }, { v: "normal", l: "Normal" }, { v: "hard", l: "Hard" }]} onChange={(v) => set("difficulty", v)} />
        </div>
        <div className="kw-panel space-y-4 p-5">
          <h3 className="kw-display text-xl text-cyan-300">Graphics</h3>
          <Seg<Quality> label="Quality" value={settings.quality} options={[{ v: "auto", l: "Auto" }, { v: "low", l: "Low" }, { v: "medium", l: "Med" }, { v: "high", l: "High" }]} onChange={(v) => set("quality", v)} />
          <p className="text-[11px] text-slate-400">Auto picks High on desktop, Low on touch devices, and drops quality if the frame rate dips.</p>
          <Toggle label="Screen shake" value={settings.shake} onChange={(v) => set("shake", v)} />
          <Toggle label="Show FPS" value={settings.showFps} onChange={(v) => set("showFps", v)} />
          <h3 className="kw-display pt-2 text-xl text-cyan-300">Controls</h3>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {touch ? (
              <>
                <b className="text-yellow-300">Left stick</b>
                <span>Steer and auto-accelerate; pull down to reverse</span>
                <b className="text-yellow-300">FIRE</b>
                <span>Fire weapon straight ahead; turn kart to aim</span>
                <b className="text-yellow-300">DRIFT</b>
                <span>Hold while turning, release for mini-turbo</span>
                <b className="text-yellow-300">BOOST</b>
                <span>Hold to spend boost meter</span>
              </>
            ) : (
              <>
                <b className="text-yellow-300">W A S D / Arrows</b>
                <span>Drive &amp; steer</span>
                <b className="text-yellow-300">Space</b>
                <span>Drift (hold, release for mini-turbo)</span>
                <b className="text-yellow-300">Shift</b>
                <span>Boost</span>
                <b className="text-yellow-300">F</b>
                <span>Fire weapon straight ahead (hold for auto-fire)</span>
              </>
            )}
            <b className="text-yellow-300">Esc / P</b>
            <span>Pause</span>
            <b className="text-yellow-300">R</b>
            <span>Instant restart (paused / game over)</span>
          </div>
          <button className="kw-btn cyan small w-full" onClick={onReplayTutorial}><span>↻ Replay Tutorial</span></button>
        </div>
      </div>
    </div>
  );
}
