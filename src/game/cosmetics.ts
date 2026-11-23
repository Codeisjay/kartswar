import type { Profile } from "./types";

export interface PaintSkin {
  id: string;
  name: string;
  primary: number | null;
  accent: number | null;
  price: number;
}

export interface WheelStyle {
  id: string;
  name: string;
  rimColor: number | null;
  price: number;
}

export const PAINT_SKINS: PaintSkin[] = [
  { id: "factory", name: "Factory Finish", primary: null, accent: null, price: 0 },
  { id: "sunset", name: "Sunset Rush", primary: 0xff4f72, accent: 0xffd166, price: 150 },
  { id: "neon", name: "Neon Circuit", primary: 0x12c2e9, accent: 0xc471ed, price: 220 },
  { id: "toxic", name: "Toxic Pulse", primary: 0x39a935, accent: 0xe6ff3a, price: 300 },
  { id: "royal", name: "Royal Chrome", primary: 0x263b88, accent: 0xf5c542, price: 400 },
];

export const WHEEL_STYLES: WheelStyle[] = [
  { id: "stock", name: "Stock", rimColor: null, price: 0 },
  { id: "gold", name: "Gold Alloy", rimColor: 0xffc33b, price: 120 },
  { id: "neon", name: "Neon Rings", rimColor: 0x35f0ff, price: 180 },
  { id: "chrome", name: "Chrome", rimColor: 0xdce5f2, price: 260 },
];

export function getPaintSkin(id: string): PaintSkin {
  return PAINT_SKINS.find((skin) => skin.id === id) ?? PAINT_SKINS[0];
}

export function getWheelStyle(id: string): WheelStyle {
  return WHEEL_STYLES.find((style) => style.id === id) ?? WHEEL_STYLES[0];
}

export function buyCosmetic(profile: Profile, id: string): Profile | null {
  const paint = PAINT_SKINS.find((skin) => skin.id === id);
  if (paint) {
    if (profile.ownedPaints.includes(id) || profile.credits < paint.price) return null;
    return {
      ...profile,
      credits: profile.credits - paint.price,
      paintId: id,
      ownedPaints: [...profile.ownedPaints, id],
    };
  }

  const wheels = WHEEL_STYLES.find((style) => style.id === id);
  if (!wheels || profile.ownedWheelStyles.includes(id) || profile.credits < wheels.price) return null;
  return {
    ...profile,
    credits: profile.credits - wheels.price,
    wheelStyle: id,
    ownedWheelStyles: [...profile.ownedWheelStyles, id],
  };
}

export function calculateMatchCredits(score: number, won: boolean): number {
  const safeScore = Number.isFinite(score) ? Math.max(0, score) : 0;
  return Math.min(200, 10 + Math.floor(safeScore / 100) + (won ? 25 : 0));
}
