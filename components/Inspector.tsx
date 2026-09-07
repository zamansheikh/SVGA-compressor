"use client";

import type { ReactNode } from "react";
import { formatBytes } from "@/lib/compress";

export type InspectorTab = "text" | "compress" | "watermark";

type Props = {
  tab: InspectorTab;
  onTab: (t: InspectorTab) => void;
  panels: Record<InspectorTab, ReactNode>;
  /** Small marks on tabs that have something active. */
  active: Partial<Record<InspectorTab, boolean>>;
  originalSize: number | null;
  resultSize: number | null;
  /** The built result is out of date with the current settings. */
  stale: boolean;
  building: boolean;
  progress: { done: number; total: number; label: string } | null;
  canBuild: boolean;
  onBuild: () => void;
  onDownload: () => void;
  downloadName: string | null;
};

const TABS: { id: InspectorTab; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "compress", label: "Compress" },
  { id: "watermark", label: "Watermark" },
];

export default function Inspector({ tab, onTab, panels, active, originalSize, resultSize, stale, building, progress, canBuild, onBuild, onDownload, downloadName }: Props) {
  const saved = originalSize && resultSize ? ((originalSize - resultSize) / originalSize) * 100 : null;
  const hasResult = resultSize != null && !stale;

  return (
    <aside className="glass rounded-2xl flex flex-col min-h-0" aria-label="Inspector">
      <div className="flex gap-1 p-2 border-b border-white/5" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => onTab(t.id)}
            className={`relative flex-1 rounded-lg px-3 py-2 text-xs font-medium transition ${tab === t.id ? "bg-white/10 text-white" : "text-white/60 hover:text-white hover:bg-white/5"}`}>
            {t.label}
            {active[t.id] && <span className="absolute top-1.5 right-2 h-1.5 w-1.5 rounded-full bg-emerald-400" />}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 max-h-[52vh] lg:max-h-[60vh]">
        {panels[tab]}
      </div>

      {/* Footer: numbers + the one action */}
      <div className="border-t border-white/5 p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Original" value={originalSize != null ? formatBytes(originalSize) : "—"} />
          <Stat label="Result" value={hasResult ? formatBytes(resultSize!) : stale && resultSize != null ? "out of date" : "—"} strong={hasResult} />
          <Stat label="Saved" value={hasResult && saved != null ? `${saved >= 0 ? "−" : "+"}${Math.abs(saved).toFixed(0)}%` : "—"} tone={hasResult && saved != null ? (saved > 0 ? "good" : "bad") : undefined} />
        </div>

        {building && progress && progress.total > 0 && (
          <div>
            <div className="flex items-center justify-between text-[11px] text-white/60 mb-1">
              <span className="truncate">{progress.label}</span>
              <span className="font-mono tabular-nums">{progress.done}/{progress.total}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-brand-500 to-violet-500 transition-all" style={{ width: `${Math.min(100, (progress.done / Math.max(1, progress.total)) * 100)}%` }} />
            </div>
          </div>
        )}

        {hasResult ? (
          <div className="flex gap-2">
            <button type="button" onClick={onDownload} disabled={building}
              className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-brand-500 to-violet-500 shadow-lg shadow-brand-500/30 hover:shadow-brand-500/50 transition disabled:opacity-60">
              Download {downloadName ? <span className="font-normal text-white/80">{downloadName}</span> : ".svga"}
            </button>
            <button type="button" onClick={onBuild} disabled={building || !canBuild} title="Build again with the current settings"
              className="rounded-xl px-3 py-3 text-sm font-medium text-white/80 bg-white/10 hover:bg-white/20 transition disabled:opacity-40">
              ↻
            </button>
          </div>
        ) : (
          <button type="button" onClick={onBuild} disabled={building || !canBuild}
            className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-brand-500 to-violet-500 shadow-lg shadow-brand-500/30 hover:shadow-brand-500/50 transition disabled:opacity-60 disabled:cursor-not-allowed">
            {building ? "Building…" : stale ? "Rebuild result" : "Build result"}
          </button>
        )}
        <p className="text-[10px] text-white/35 text-center">Nothing leaves your browser.</p>
      </div>
    </aside>
  );
}

function Stat({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "good" | "bad" }) {
  const toneClass = tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-red-400" : "text-white";
  return (
    <div className="rounded-lg bg-white/5 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
      <div className={`font-mono tabular-nums text-sm ${strong ? "font-semibold" : ""} ${toneClass}`}>{value}</div>
    </div>
  );
}
