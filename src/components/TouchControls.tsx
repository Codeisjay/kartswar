"use client";

import { useEffect, useRef, useState } from "react";
import type { TouchInput } from "@/game/types";
import { createTouchInput, smoothTouchDrive } from "@/game/touchControls";

type Action = "left" | "right" | "fire" | "drift" | "boost";

interface Props {
  onChange: (t: TouchInput | null) => void;
}

const DRIVE_ACTIONS: Action[] = ["left", "right"];

export default function TouchControls({ onChange }: Props) {
  const input = useRef<TouchInput>(createTouchInput());
  const held = useRef<Record<Action, boolean>>({
    left: false,
    right: false,
    fire: false,
    drift: false,
    boost: false,
  });
  const pointerActions = useRef(new Map<number, Action>());
  const callback = useRef(onChange);
  const frame = useRef<number | null>(null);
  const lastFrameTime = useRef<number | null>(null);
  const [pressed, setPressed] = useState<Partial<Record<Action, boolean>>>({});
  callback.current = onChange;
  const clearInputsRef = useRef<(updateVisual?: boolean) => void>(() => undefined);

  const publish = () => callback.current(input.current);

  const stopFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    lastFrameTime.current = null;
  };

  const updateDrive = (now: number) => {
    const dt = lastFrameTime.current === null ? 0 : (now - lastFrameTime.current) / 1000;
    lastFrameTime.current = now;
    const steer = Number(held.current.right) - Number(held.current.left);
    const next = smoothTouchDrive(input.current, { steer, throttle: 1 }, dt);
    const changed = next.steer !== input.current.steer;
    input.current.steer = next.steer;
    if (changed) publish();

    const hasHeldDriveInput = DRIVE_ACTIONS.some((action) => held.current[action]);
    if (hasHeldDriveInput || next.steer !== 0) {
      frame.current = requestAnimationFrame(updateDrive);
    } else {
      stopFrame();
    }
  };

  const startDriveUpdates = () => {
    if (frame.current === null) frame.current = requestAnimationFrame(updateDrive);
  };

  const press = (action: Action, pointerId: number, element: HTMLButtonElement) => {
    element.setPointerCapture(pointerId);
    pointerActions.current.set(pointerId, action);
    held.current[action] = true;
    setPressed((previous) => ({ ...previous, [action]: true }));

    if (action === "fire" || action === "drift" || action === "boost") {
      input.current[action] = true;
      publish();
    } else {
      startDriveUpdates();
    }
  };

  const release = (pointerId: number) => {
    const action = pointerActions.current.get(pointerId);
    if (!action) return;
    pointerActions.current.delete(pointerId);
    held.current[action] = Array.from(pointerActions.current.values()).includes(action);
    setPressed((previous) => ({ ...previous, [action]: held.current[action] }));

    if (action === "fire" || action === "drift" || action === "boost") {
      input.current[action] = held.current[action];
      publish();
    } else {
      startDriveUpdates();
    }
  };

  const clearInputs = (updateVisual = true) => {
    pointerActions.current.clear();
    for (const action of Object.keys(held.current) as Action[]) held.current[action] = false;
    if (updateVisual) setPressed({});
    input.current.fire = false;
    input.current.drift = false;
    input.current.boost = false;
    input.current.steer = 0;
    input.current.throttle = 1;
    stopFrame();
    callback.current(null);
  };
  clearInputsRef.current = clearInputs;

  useEffect(() => {
    publish();
    const handleBlur = () => clearInputsRef.current();
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("blur", handleBlur);
      clearInputsRef.current(false);
    };
  }, []);

  const button = (action: Action, label: string, glyph: string, className: string) => (
    <button
      key={action}
      type="button"
      aria-label={label}
      aria-pressed={pressed[action] ?? false}
      data-pressed={pressed[action] ?? false}
      className={`kw-touch-arrow ${className}`}
      style={{ touchAction: "none" }}
      onPointerDown={(event) => {
        event.preventDefault();
        press(action, event.pointerId, event.currentTarget);
      }}
      onPointerUp={(event) => release(event.pointerId)}
      onPointerCancel={(event) => release(event.pointerId)}
      onLostPointerCapture={(event) => release(event.pointerId)}
    >
      {glyph}
    </button>
  );

  return (
    <div data-ui className="kw-touch-controls pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between" style={{ touchAction: "none" }}>
      <div className="kw-touch-steering-pad pointer-events-auto" role="group" aria-label="Steering controls">
        <span className="kw-touch-steer-label">STEER</span>
        {button("left", "Steer left", "◀", "kw-touch-steer-arrow")}
        {button("right", "Steer right", "▶", "kw-touch-steer-arrow")}
      </div>

      <div className="kw-touch-actions pointer-events-auto relative" style={{ touchAction: "none" }}>
        {button("fire", "Fire weapon", "FIRE", "kw-touch-fire kw-display")}
        {button("drift", "Drift", "DRIFT", "kw-touch-drift kw-display")}
        {button("boost", "Boost", "BOOST", "kw-touch-boost kw-display")}
      </div>
    </div>
  );
}
