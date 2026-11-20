import { boolean, integer, jsonb, serial, text, timestamp } from "drizzle-orm/pg-core";
import { pgTable } from "drizzle-orm/pg-core";

export const rooms = pgTable("rooms", {
  code: text("code").primaryKey(),
  hostId: text("host_id"),
  mapId: text("map_id").notNull().default("neon"),
  mode: text("mode").notNull().default("ffa"),
  status: text("status").notNull().default("lobby"), // lobby | playing | ended
  seed: integer("seed").notNull().default(1),
  maxPlayers: integer("max_players").notNull().default(8),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const roomPlayers = pgTable("room_players", {
  id: text("id").primaryKey(),
  roomCode: text("room_code").notNull(),
  name: text("name").notNull(),
  avatar: text("avatar").notNull().default("😎"),
  kartId: integer("kart_id").notNull().default(0),
  isHost: boolean("is_host").notNull().default(false),
  isAi: boolean("is_ai").notNull().default(false),
  state: jsonb("state").$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const roomEvents = pgTable("room_events", {
  id: serial("id").primaryKey(),
  roomCode: text("room_code").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const scoreRows = pgTable("score_rows", {
  id: serial("id").primaryKey(),
  roomCode: text("room_code").notNull(),
  playerId: text("player_id").notNull(),
  name: text("name").notNull(),
  score: integer("score").notNull().default(0),
  kills: integer("kills").notNull().default(0),
  deaths: integer("deaths").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
});
