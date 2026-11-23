"use client";

import { useState } from "react";
import type { TutorialState } from "@/game/types";

interface KeyIndicator {
  label: string;
  codes: string[];
}

interface StepDefinition {
  title: string;
  instruction: string;
  touchInstruction: string;
  objective: string;
  keys: KeyIndicator[];
}

export const TUTORIAL_STEPS: StepDefinition[] = [
  {
    title: "Get moving",
    instruction: "Hold W or the Up Arrow to accelerate your kart.",
    touchInstruction: "The left stick steers and auto-accelerates. Push it forward to move.",
    objective: "Reach 8 KM/H",
    keys: [{ label: "W", codes: ["KeyW"] }, { label: "↑", codes: ["ArrowUp"] }],
  },
  {
    title: "Steer both ways",
    instruction: "Use A / D or the Left / Right Arrows. Your kart's nose also aims your weapon.",
    touchInstruction: "Move the left stick left, then right. Your kart's nose also aims your weapon.",
    objective: "Turn left and right",
    keys: [{ label: "A", codes: ["KeyA"] }, { label: "←", codes: ["ArrowLeft"] }, { label: "D", codes: ["KeyD"] }, { label: "→", codes: ["ArrowRight"] }],
  },
  {
    title: "Reverse and brake",
    instruction: "Hold S or the Down Arrow to reverse and slow down.",
    touchInstruction: "Pull the left stick down to reverse or brake.",
    objective: "Reverse for a moment",
    keys: [{ label: "S", codes: ["KeyS"] }, { label: "↓", codes: ["ArrowDown"] }],
  },
  {
    title: "Drive the arena",
    instruction: "Practice steering around the arena's barriers. Keep moving and change direction as you go.",
    touchInstruction: "Explore the arena with the left stick and steer around its barriers.",
    objective: "Drive 25 meters",
    keys: [{ label: "W", codes: ["KeyW"] }, { label: "A", codes: ["KeyA"] }, { label: "D", codes: ["KeyD"] }],
  },
  {
    title: "Hit the boost",
    instruction: "Hold either Shift key to spend boost meter for a burst of speed.",
    touchInstruction: "Hold the green BOOST button for a burst of speed.",
    objective: "Activate boost",
    keys: [{ label: "SHIFT", codes: ["ShiftLeft", "ShiftRight"] }],
  },
  {
    title: "Complete the course",
    instruction: "Follow the open arena lanes, steer through the turns and cover a little more ground.",
    touchInstruction: "Follow the open arena lanes, steering with the left stick as you go.",
    objective: "Drive 60 more meters",
    keys: [{ label: "W", codes: ["KeyW"] }, { label: "←", codes: ["ArrowLeft"] }, { label: "→", codes: ["ArrowRight"] }],
  },
  {
    title: "Line up a target",
    instruction: "Weapons fire straight ahead. Steer the kart's nose toward the marked practice target; there is no mouse aiming.",
    touchInstruction: "Turn the kart toward the marked target with the left stick. Weapons fire straight ahead.",
    objective: "Bring the target into the reticle",
    keys: [{ label: "A", codes: ["KeyA"] }, { label: "D", codes: ["KeyD"] }],
  },
  {
    title: "Fire at the target",
    instruction: "Hold F to fire your current weapon. Watch ammo and the cooldown meter in the HUD.",
    touchInstruction: "Hold the red FIRE button. Watch ammo and the cooldown meter in the HUD.",
    objective: "Hit the practice target",
    keys: [{ label: "F", codes: ["KeyF"] }],
  },
  {
    title: "Collect a power-up",
    instruction: "Drive into the highlighted glowing box. Pickups grant a random weapon or ability.",
    touchInstruction: "Follow the arrow and drive into the highlighted glowing box.",
    objective: "Collect the shield pickup",
    keys: [{ label: "W", codes: ["KeyW"] }, { label: "A", codes: ["KeyA"] }, { label: "D", codes: ["KeyD"] }],
  },
  {
    title: "Use your shield",
    instruction: "With the shield equipped, hold F to activate it. Shields protect you for 7 seconds.",
    touchInstruction: "With the shield equipped, hold FIRE to activate it for 7 seconds.",
    objective: "Activate your shield",
    keys: [{ label: "F", codes: ["KeyF"] }],
  },
];

export function WelcomeOverlay({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#050611]/85 p-4 backdrop-blur-md">
      <section className="kw-panel kw-pop relative w-full max-w-2xl overflow-hidden border-cyan-300/50 p-5 text-center sm:p-9">
        <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-pink-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-20 h-56 w-56 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative">
          <div className="kw-display text-xs tracking-[0.4em] text-cyan-200">PLAYER BRIEFING · 01</div>
          <h2 className="kw-display kw-title mt-3 text-5xl leading-none sm:text-7xl">Welcome to Kart Wars!</h2>
          <p className="kw-display mt-3 text-xl tracking-[0.16em] text-pink-300 sm:text-2xl">Ready to rule the arena?</p>
          <div className="mt-7 grid gap-3 text-left sm:grid-cols-3">
            {[
              ["01", "DRIVE", "Master your kart and navigate the arena.", "text-cyan-300"],
              ["02", "FIGHT", "Attack opponents using powerful weapons.", "text-pink-300"],
              ["03", "SURVIVE", "Dodge attacks, grab power-ups and climb the leaderboard.", "text-yellow-300"],
            ].map(([number, title, description, color]) => (
              <div key={title} className="rounded-xl border border-white/10 bg-black/30 p-4">
                <div className={`kw-display text-sm ${color}`}>{number} / {title}</div>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{description}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 text-sm text-slate-300">Learn the real controls in a safe practice arena. It takes about a minute.</p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <button className="kw-btn cyan" onClick={onStart}><span>▶ Start Tutorial</span></button>
            <button className="kw-btn ghost small" onClick={onSkip}><span>Skip Tutorial</span></button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function HelpOverlay({ touch, onClose }: { touch: boolean; onClose: () => void }) {
  return (
    <div data-ui className="absolute inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-3 backdrop-blur-sm">
      <section className="kw-panel kw-pop max-h-[92vh] w-full max-w-xl overflow-y-auto p-5 sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="kw-display text-xs tracking-[0.3em] text-cyan-300">DRIVER FIELD GUIDE</div>
            <h2 className="kw-display kw-title mt-1 text-5xl">Help / Controls</h2>
          </div>
          <button className="kw-chip px-3 py-1 text-sm" onClick={onClose} aria-label="Close help">✕</button>
        </div>
        {touch ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <HelpTile icon="🕹️" title="Steer & drive" text="The left stick steers and auto-accelerates. Pull it down to reverse or brake." />
            <HelpTile icon="🔴" title="Fire & aim" text="Hold FIRE to shoot. Turn your kart to aim; weapons fire from its nose." />
            <HelpTile icon="🟡" title="Drift" text="Hold DRIFT while turning. Release to trigger a mini-turbo when charged." />
            <HelpTile icon="🟢" title="Boost" text="Hold BOOST to spend your boost meter and surge forward." />
          </div>
        ) : (
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <HelpTile icon="W ↑" title="Accelerate" text="Hold W or Up Arrow." />
            <HelpTile icon="S ↓" title="Reverse / brake" text="Hold S or Down Arrow." />
            <HelpTile icon="A D" title="Steer" text="A / D or Left / Right Arrows." />
            <HelpTile icon="SPACE" title="Drift" text="Hold while turning; release for a mini-turbo." />
            <HelpTile icon="SHIFT" title="Boost" text="Hold either Shift key to spend boost meter." />
            <HelpTile icon="F" title="Fire" text="Hold to fire; weapons shoot straight from the kart's nose." />
          </div>
        )}
        <div className="mt-4 rounded-xl border border-yellow-300/20 bg-yellow-300/5 p-4 text-sm leading-relaxed text-slate-300">
          <b className="text-yellow-200">Weapons & defense:</b> Drive through glowing boxes for a random weapon or ability. The HUD shows ammo and cooldown. Fire activates the equipped ability; a shield blocks damage for 7 seconds. Rockets automatically home onto an eligible rival ahead (within 75 m and roughly a 40° forward cone). Other weapons do not lock on.
        </div>
        <p className="mt-3 text-xs text-slate-400">{touch ? "Touch controls are active on this device." : "Aim by steering—mouse aiming and gamepad input are not supported."} Press Esc or P to pause.</p>
        <button className="kw-btn cyan mt-5 w-full" onClick={onClose}><span>Got it</span></button>
      </section>
    </div>
  );
}

export function TutorialOverlay({
  stepIndex,
  state,
  touch,
  pressedKeys,
  objectiveProgress,
  canContinue,
  onBack,
  onNext,
  onSkipStep,
  onSkipTutorial,
  onFinish,
}: {
  stepIndex: number;
  state: TutorialState;
  touch: boolean;
  pressedKeys: Set<string>;
  objectiveProgress: string;
  canContinue: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkipStep: () => void;
  onSkipTutorial: () => void;
  onFinish: () => void;
}) {
  const [minimized, setMinimized] = useState(false);
  const step = TUTORIAL_STEPS[stepIndex];
  if (!step) return null;
  const finished = stepIndex === TUTORIAL_STEPS.length - 1;
  const phaseProgress = stepIndex < 6
    ? `DRIVING · STEP ${stepIndex + 1} OF 6`
    : `COMBAT · STEP ${stepIndex - 5} OF 4`;
  if (minimized) {
    return (
      <div className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2">
        <button className="kw-chip pointer-events-auto rounded-full border-cyan-300/40 bg-[#080b1b]/80 px-3 py-1 text-[10px] font-bold text-cyan-100 shadow-lg backdrop-blur-sm" onClick={() => setMinimized(false)}>
          {phaseProgress} · SHOW ▾
        </button>
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <section className="kw-panel pointer-events-auto absolute inset-x-2 top-2 mx-auto w-[min(94vw,460px)] border-cyan-300/30 bg-[#080b1b]/65 p-2 shadow-[0_6px_18px_rgba(0,0,0,0.18)]">
        <div className="flex items-center justify-between gap-2">
          <div className="kw-display truncate text-[10px] tracking-wider text-cyan-300">{phaseProgress} <span className="text-slate-500">· {step.title}</span></div>
          <div className="flex shrink-0 items-center gap-1">
            {!touch && step.keys.map((key) => {
              const active = key.codes.some((code) => pressedKeys.has(code));
              return <kbd key={key.label} className={`tutorial-key !min-h-6 !min-w-6 !rounded !border-b-2 !px-1 !py-0 !text-[10px] ${active ? "tutorial-key-active" : ""}`}>{key.label}</kbd>;
            })}
            {touch && <span className="text-[9px] font-bold text-cyan-200">🕹️ TOUCH</span>}
            <button className="kw-chip ml-1 px-1.5 py-0.5 text-[9px] text-slate-200" onClick={() => setMinimized(true)} aria-label="Minimize tutorial">HIDE</button>
          </div>
        </div>
        <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-[10px] text-slate-300">{touch ? step.touchInstruction : step.instruction}</p>
          {stepIndex === 6 && (
            <span className={`flex shrink-0 items-center gap-1 text-[9px] font-bold ${state.targetInRange ? "text-green-200" : "text-yellow-100"}`}>
              <span className="inline-block text-sm text-cyan-300" style={{ transform: `rotate(${state.targetBearing ?? 0}deg)` }}>⬆</span>
              {state.targetInRange ? "LOCKED" : "TARGET"}
            </span>
          )}
          {stepIndex === 8 && state.pickupDistance !== null && (
            <span className="flex shrink-0 items-center gap-1 text-[9px] font-bold text-cyan-100">
              <span className="inline-block text-sm text-yellow-300" style={{ transform: `rotate(${state.pickupBearing ?? 0}deg)` }}>⬆</span>
              {Math.round(state.pickupDistance)}M
            </span>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-1 border-t border-white/10 pt-1.5">
          <div className="min-w-0 truncate text-[9px] font-bold uppercase tracking-wide text-yellow-200">
            {step.objective} <span className={`ml-1 ${canContinue ? "text-green-300" : "text-slate-400"}`}>{canContinue ? "✓" : objectiveProgress}</span>
          </div>
          <div className="flex shrink-0 gap-1">
            <button className="kw-chip px-1.5 py-1 text-[9px] text-slate-200" onClick={onBack} disabled={stepIndex === 0}>BACK</button>
            <button className="kw-chip px-1.5 py-1 text-[9px] text-slate-200" onClick={onSkipStep}>SKIP STEP</button>
            <button className="kw-chip px-1.5 py-1 text-[9px] text-slate-200" onClick={onSkipTutorial}>SKIP TUTORIAL</button>
            <button className={`kw-chip px-2 py-1 text-[9px] font-bold ${finished ? "border-pink-300/60 bg-pink-300/15 text-pink-100" : "border-cyan-300/60 bg-cyan-300/15 text-cyan-100"}`} onClick={finished ? onFinish : onNext}>
              {finished ? "FINISH" : "NEXT"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function HelpTile({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-3">
      <div className="flex items-center gap-2">
        <span className="kw-display min-w-12 text-center text-sm text-yellow-200">{icon}</span>
        <b className="kw-display text-sm text-cyan-200">{title}</b>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-300">{text}</p>
    </div>
  );
}
