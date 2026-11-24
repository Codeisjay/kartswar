"use client";

import { useRef, useState } from "react";
import type { TouchInput } from "@/game/types";

interface Props {
  onChange: (t: TouchInput) => void;
}

export default function TouchControls({ onChange }: Props) {
  const state = useRef<TouchInput>({ steer: 0, throttle: 1, drift: false, boost: false, fire: false });
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const stickId = useRef<number | null>(null);
  const baseRef = useRef<HTMLDivElement>(null);

  const moveStick = (e: React.PointerEvent) => {
    const el = baseRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const max = r.width / 2 - 14;
    const d = Math.hypot(dx, dy);
    if (d > max) {
      dx = (dx / d) * max;
      dy = (dy / d) * max;
    }
    setKnob({ x: dx, y: dy });
    state.current.steer = Math.max(-1, Math.min(1, dx / (max * 0.8)));
    state.current.throttle = dy > max * 0.5 ? -1 : 1; // auto-gas, pull back to brake/reverse
    onChange({ ...state.current });
  };

  const stickDown = (e: React.PointerEvent) => {
    e.preventDefault();
    stickId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    moveStick(e);
  };
  const stickMove = (e: React.PointerEvent) => {
    if (stickId.current === e.pointerId) moveStick(e);
  };
  const stickUp = (e: React.PointerEvent) => {
    if (stickId.current !== e.pointerId) return;
    stickId.current = null;
    setKnob({ x: 0, y: 0 });
    state.current.steer = 0;
    state.current.throttle = 1;
    onChange({ ...state.current });
  };

  return (
    <div data-ui className="kw-touch-controls pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between" style={{ touchAction: "none" }}>
      <div
        ref={baseRef}
        className="kw-touch-stick pointer-events-auto relative rounded-full border-2 border-cyan-300/50 bg-cyan-300/10"
        style={{ touchAction: "none" }}
        onPointerDown={stickDown}
        onPointerMove={stickMove}
        onPointerUp={stickUp}
        onPointerCancel={stickUp}
      >
        <div className="kw-touch-knob absolute left-1/2 top-1/2 rounded-full border-2 border-cyan-200 bg-cyan-300/40 shadow-[0_0_20px_rgba(53,232,255,0.6)]" style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
        <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-bold tracking-widest text-cyan-200/70">STEER</div>
      </div>
      <div className="kw-touch-actions pointer-events-auto relative" style={{ touchAction: "none" }}>
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            state.current.fire = true;
            onChange({ ...state.current });
          }}
          onPointerUp={() => {
            state.current.fire = false;
            onChange({ ...state.current });
          }}
          onPointerCancel={() => {
            state.current.fire = false;
            onChange({ ...state.current });
          }}
          className="kw-touch-fire kw-display absolute bottom-0 right-0 rounded-full border-4 border-red-200/70 bg-red-500/70 text-white shadow-[0_0_28px_rgba(255,50,70,0.7)] active:scale-95"
          style={{ touchAction: "none" }}
        >
          FIRE
        </button>
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            state.current.drift = true;
            onChange({ ...state.current });
          }}
          onPointerUp={() => {
            state.current.drift = false;
            onChange({ ...state.current });
          }}
          onPointerCancel={() => {
            state.current.drift = false;
            onChange({ ...state.current });
          }}
          className="kw-touch-drift kw-display absolute rounded-full border-2 border-yellow-200/70 bg-yellow-400/40 text-xs text-white active:scale-95"
          style={{ touchAction: "none" }}
        >
          DRIFT
        </button>
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            state.current.boost = true;
            onChange({ ...state.current });
          }}
          onPointerUp={() => {
            state.current.boost = false;
            onChange({ ...state.current });
          }}
          onPointerCancel={() => {
            state.current.boost = false;
            onChange({ ...state.current });
          }}
          className="kw-touch-boost kw-display absolute rounded-full border-2 border-green-200/70 bg-green-400/40 text-xs text-white active:scale-95"
          style={{ touchAction: "none" }}
        >
          BOOST
        </button>
      </div>
    </div>
  );
}
