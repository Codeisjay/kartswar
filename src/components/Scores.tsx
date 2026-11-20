"use client";

import type { ScoreEntry } from "@/game/storage";

const MODE_LABEL = { ffa: "Free For All", team: "Team Battle", survival: "Survival" } as const;

export default function ScoreTable({ scores, highlight, limit = 10 }: { scores: ScoreEntry[]; highlight?: number; limit?: number }) {
  if (!scores.length) {
    return <div className="py-8 text-center text-sm text-slate-400">No scores yet — go set one!</div>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-white/10">
      <table className="w-full text-sm">
        <thead className="bg-white/5 text-left text-[11px] uppercase tracking-widest text-slate-400">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Driver</th>
            <th className="px-3 py-2">Mode</th>
            <th className="px-3 py-2 text-right">Kills</th>
            <th className="px-3 py-2 text-right">Score</th>
          </tr>
        </thead>
        <tbody>
          {scores.slice(0, limit).map((s, i) => (
            <tr key={`${s.date}-${i}`} className={`border-t border-white/5 ${highlight === i ? "bg-yellow-300/15 text-yellow-100" : ""}`}>
              <td className="px-3 py-1.5 font-bold text-slate-300">{i + 1}</td>
              <td className="px-3 py-1.5">
                <span className="mr-1.5">{s.avatar}</span>
                {s.name}
              </td>
              <td className="px-3 py-1.5 text-slate-300">
                {MODE_LABEL[s.mode]}
                {s.mode === "survival" && s.wave ? ` · W${s.wave}` : ""}
              </td>
              <td className="px-3 py-1.5 text-right">{s.kills}</td>
              <td className="kw-display px-3 py-1.5 text-right text-base text-yellow-300">{s.score.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
