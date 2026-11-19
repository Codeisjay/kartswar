import type { Game, Kart } from "./engine";

export interface BotState {
  skill: number;
  target: Kart | null;
  retarget: number;
  wx: number;
  wz: number;
  wanderT: number;
  stuckT: number;
  reverseT: number;
  reverseSteer: number;
  avoidDir: number;
  offX: number;
  offZ: number;
  aimT: number;
  losT: number;
  los: boolean;
  burstT: number;
  burstOn: boolean;
  reactT: number;
  circleDir: number;
  pickupT: number;
}

export function newBotState(skill: number): BotState {
  return {
    skill, target: null, retarget: Math.random() * 0.5, wx: 0, wz: 0, wanderT: 0, stuckT: 0, reverseT: 0, reverseSteer: 1,
    avoidDir: Math.random() < 0.5 ? 1 : -1, offX: 0, offZ: 0, aimT: 0, losT: 0, los: false, burstT: 0, burstOn: false,
    reactT: 1 + Math.random(), circleDir: Math.random() < 0.5 ? 1 : -1, pickupT: 0,
  };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export function updateBot(g: Game, k: Kart, s: BotState, dt: number, active: boolean) {
  const inp = k.input;
  inp.fire = false;
  inp.drift = false;
  inp.boost = false;
  if (!k.alive || !active) {
    inp.throttle = 0;
    inp.steer = 0;
    return;
  }
  const half = g.arena.half;
  const spd = Math.hypot(k.vx, k.vz);
  const fx = Math.sin(k.heading);
  const fz = Math.cos(k.heading);

  // ---- target selection
  s.retarget -= dt;
  if (s.retarget <= 0) {
    s.retarget = 0.5 + Math.random() * 0.6;
    let best: Kart | null = null;
    let bs = 1e9;
    for (const o of g.karts) {
      if (!o.alive || !g.isEnemy(k, o)) continue;
      const d = Math.hypot(o.x - k.x, o.z - k.z);
      let sc = d - (o.hp < 40 ? 12 : 0) - (o.isPlayer && g.mode === "survival" ? 18 : 0);
      if (o.invuln > 0) sc += 40;
      if (sc < bs) {
        bs = sc;
        best = o;
      }
    }
    s.target = best;
  }
  const t = s.target && s.target.alive ? s.target : null;
  const dT = t ? Math.hypot(t.x - k.x, t.z - k.z) : 1e9;

  // ---- goal selection
  let gx = 0;
  let gz = 0;
  let hasGoal = false;
  const lowHp = k.hp < k.maxHp * 0.45;
  if (lowHp || !k.weapon) {
    let bd = 75;
    for (const p of g.pickups) {
      if (!p.active || p.spot.y > 0.1) continue;
      if (lowHp && p.spot.kind !== "health" && k.weapon) continue;
      if (!lowHp && p.spot.kind === "health") continue;
      const d = Math.hypot(p.spot.x - k.x, p.spot.z - k.z);
      if (d < bd) {
        bd = d;
        gx = p.spot.x;
        gz = p.spot.z;
        hasGoal = true;
      }
    }
    // if an enemy is very close and we have no weapon, still prefer pickup
  }
  if (!hasGoal && t) {
    const w = k.weapon;
    const ideal = w === "rocket" ? 24 : w === "mg" ? 13 : w === "bomb" ? 20 : w === "mine" ? 28 : 16;
    const lead = dT / 40;
    const px = t.x + t.vx * lead * 0.5 * s.skill;
    const pz = t.z + t.vz * lead * 0.5 * s.skill;
    if (dT < ideal * 0.55) {
      const a = Math.atan2(t.x - k.x, t.z - k.z) + (Math.PI / 2) * s.circleDir;
      gx = k.x + Math.sin(a) * 20;
      gz = k.z + Math.cos(a) * 20;
    } else if (w === "mine" && dT < 40) {
      // run away dropping mines
      const a = Math.atan2(t.x - k.x, t.z - k.z) + Math.PI * 0.8 * s.circleDir;
      gx = k.x + Math.sin(a) * 25;
      gz = k.z + Math.cos(a) * 25;
    } else {
      gx = px;
      gz = pz;
    }
    hasGoal = true;
  }
  if (!hasGoal) {
    s.wanderT -= dt;
    if (s.wanderT <= 0 || Math.hypot(s.wx - k.x, s.wz - k.z) < 9) {
      s.wanderT = 4 + Math.random() * 4;
      s.wx = (Math.random() - 0.5) * (half * 2 - 24);
      s.wz = (Math.random() - 0.5) * (half * 2 - 24);
    }
    gx = s.wx;
    gz = s.wz;
  }
  gx = clamp(gx, -half + 4, half - 4);
  gz = clamp(gz, -half + 4, half - 4);

  // ---- steering with feelers
  let desired = Math.atan2(gx - k.x, gz - k.z);
  const L = 7 + spd * 0.32;
  const feel = (off: number) => {
    const a = k.heading + off;
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    return g.probeBlocked(k.x + sx * L * 0.5, k.z + sz * L * 0.5, k.y) || g.probeBlocked(k.x + sx * L, k.z + sz * L, k.y);
  };
  const bc = feel(0);
  const bl = feel(0.6);
  const br = feel(-0.6);
  let slow = false;
  if (bc || (bl && br)) {
    slow = true;
    if (!bl && br) desired = k.heading + 1.1;
    else if (!br && bl) desired = k.heading - 1.1;
    else desired = k.heading + s.avoidDir * 1.3;
  } else if (bl) {
    desired = k.heading - 0.55;
  } else if (br) {
    desired = k.heading + 0.55;
  }
  const d = wrap(desired - k.heading);
  inp.steer = clamp(-d * 2.2, -1, 1);
  inp.throttle = 1;
  if (Math.abs(d) > 1.5 && spd > 14) inp.throttle = 0.1;
  if (slow && spd > 15) inp.throttle = 0.2;
  if (s.skill > 0.55 && Math.abs(d) > 0.7 && spd > 17 && !slow) inp.drift = true;
  if (k.boostMeter > 0.55 && Math.abs(d) < 0.15 && !bc && s.skill > 0.45 && Math.hypot(gx - k.x, gz - k.z) > 36) inp.boost = true;

  // stuck handling
  if (spd < 2.5 && inp.throttle > 0) s.stuckT += dt;
  else s.stuckT = Math.max(0, s.stuckT - dt);
  if (s.stuckT > 0.7) {
    s.stuckT = 0;
    s.reverseT = 0.9;
    s.reverseSteer = Math.random() < 0.5 ? 1 : -1;
    s.avoidDir = -s.avoidDir;
  }
  if (s.reverseT > 0) {
    s.reverseT -= dt;
    inp.throttle = -1;
    inp.steer = s.reverseSteer;
    inp.drift = false;
    inp.boost = false;
  }

  // ---- combat
  s.reactT -= dt;
  s.aimT -= dt;
  s.losT -= dt;
  inp.aimX = k.x + fx * 30;
  inp.aimZ = k.z + fz * 30;
  const w = k.weapon;
  if (t) {
    if (s.aimT <= 0) {
      s.aimT = 0.3;
      const e = (1 - s.skill) * 4.5 + 0.4;
      s.offX = (Math.random() - 0.5) * e * 2;
      s.offZ = (Math.random() - 0.5) * e * 2;
    }
    if (s.losT <= 0) {
      s.losT = 0.2;
      s.los = g.hasLOS(k.x, k.z, t.x, t.z, k.y + 0.8);
    }
    const proj = w === "mg" ? 90 : w === "rocket" ? 52 : 40;
    const lead = dT / proj;
    inp.aimX = t.x + t.vx * lead * s.skill + s.offX;
    inp.aimZ = t.z + t.vz * lead * s.skill + s.offZ;
  }
  if (w) {
    const slowReact = 0.4 + (1.3 - s.skill) * 0.9;
    switch (w) {
      case "rocket":
        if (t && dT < 55 && dT > 7 && s.los && s.reactT <= 0) {
          inp.fire = true;
          s.reactT = slowReact + Math.random() * 0.5;
        }
        break;
      case "mg":
        s.burstT -= dt;
        if (s.burstT <= 0) {
          s.burstOn = !s.burstOn;
          s.burstT = s.burstOn ? 0.7 + Math.random() * 0.8 : 0.25 + Math.random() * 0.5 * (1.4 - s.skill);
        }
        if (t && dT < 32 && s.los && s.burstOn && s.reactT <= 0) inp.fire = true;
        if (t && dT < 32 && s.los && s.reactT > 0 && s.reactT < 0.05) s.reactT = 0;
        break;
      case "bomb":
        if (t && dT > 9 && dT < 36 && s.reactT <= 0) {
          inp.fire = true;
          s.reactT = slowReact + 0.6;
        }
        break;
      case "mine":
        if (t && dT < 30 && s.reactT <= 0) {
          const dot = ((t.x - k.x) * fx + (t.z - k.z) * fz) / Math.max(1, dT);
          if (dot < 0.4 || dT < 14) {
            inp.fire = true;
            s.reactT = 1.0 + Math.random() * 0.8;
          }
        }
        break;
      case "shield": {
        let incoming = false;
        for (const r of g.rockets) {
          if (r.owner !== k && g.isEnemy(r.owner, k) && Math.hypot(r.x - k.x, r.z - k.z) < 22) incoming = true;
        }
        if (incoming || (t && dT < 30 && k.hp < k.maxHp * 0.75)) inp.fire = true;
        break;
      }
      case "boost":
        if (!t || dT > 22 || k.hp < k.maxHp * 0.3) inp.fire = true;
        break;
    }
  }
  // stay out of the pause screen: bots idle during intro handled via active flag
}
