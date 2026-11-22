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
    <div data-ui className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between p-4 pb-6" style={{ touchAction: "none" }}>
      <div
        ref={baseRef}
        className="pointer-events-auto relative h-36 w-36 rounded-full border-2 border-cyan-300/50 bg-cyan-300/10"
        style={{ touchAction: "none" }}
        onPointerDown={stickDown}
        onPointerMove={stickMove}
        onPointerUp={stickUp}
        onPointerCancel={stickUp}
      >
        <div className="absolute left-1/2 top-1/2 h-14 w-14 rounded-full border-2 border-cyan-200 bg-cyan-300/40 shadow-[0_0_20px_rgba(53,232,255,0.6)]" style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
        <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-bold tracking-widest text-cyan-200/70">STEER</div>
      </div>
      <div className="pointer-events-auto relative h-44 w-52" style={{ touchAction: "none" }}>
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
          className="kw-display absolute bottom-0 right-0 h-24 w-24 rounded-full border-4 border-red-200/70 bg-red-500/70 text-lg text-white shadow-[0_0_28px_rgba(255,50,70,0.7)] active:scale-95"
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
          className="kw-display absolute bottom-2 right-28 h-16 w-16 rounded-full border-2 border-yellow-200/70 bg-yellow-400/40 text-xs text-white active:scale-95"
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
          className="kw-display absolute bottom-24 right-8 h-16 w-16 rounded-full border-2 border-green-200/70 bg-green-400/40 text-xs text-white active:scale-95"
          style={{ touchAction: "none" }}
        >
          BOOST
        </button>
      </div>
    </div>
  );
}
