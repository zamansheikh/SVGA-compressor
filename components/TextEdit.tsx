"use client";

import { useEffect, useState } from "react";
import type { MovieFile } from "@/lib/svga";
import {
  bitmapThumbnail,
  guessRegion,
  LOOK_PRESETS,
  type Analysis,
  type LookPreset,
  type Rect,
  type SiblingFile,
  type TextEditConfig,
  type TextLook,
} from "@/lib/text-edit";

type Props = {
  value: TextEditConfig;
  onChange: (v: TextEditConfig) => void;
  movie: MovieFile;
  siblings: SiblingFile[];
  otherFiles: number;
  analysis: Analysis | null;
  analyzing: boolean;
  error: string | null;
  disabled?: boolean;
};

const PRESETS: { value: LookPreset; label: string; swatch: string }[] = [
  { value: "auto", label: "Match", swatch: "conic-gradient(from 0deg, #fff, #e39b12, #5890ff, #fff)" },
  { value: "white", label: "White", swatch: "#ffffff" },
  { value: "white-outline", label: "Outlined", swatch: "linear-gradient(#fff, #fff) padding-box, #1a1a2e" },
  { value: "gold", label: "Gold", swatch: "linear-gradient(#fff2b3, #e39b12)" },
  { value: "silver", label: "Silver", swatch: "linear-gradient(#ffffff, #b9c2d0)" },
  { value: "red", label: "Red", swatch: "linear-gradient(#ff8a8a, #c1121f)" },
  { value: "black", label: "Black", swatch: "#111111" },
  { value: "custom", label: "Custom", swatch: "linear-gradient(135deg, #3066ff, #8b5cf6)" },
];

const fmt = (r: Rect | null) => (r ? `${Math.round(r.x)}, ${Math.round(r.y)} · ${Math.round(r.width)}×${Math.round(r.height)}` : "—");

/**
 * The Text tab. Three questions, top to bottom: what should it say, how
 * should it look, where is it. The third is answered automatically when
 * siblings are loaded; the stage shows the answer as a box you can move.
 */
export default function TextEdit({ value, onChange, movie, siblings, otherFiles, analysis, analyzing, error, disabled }: Props) {
  const setLook = (next: Partial<TextLook>) => onChange({ ...value, look: { ...value.look, ...next } });
  const [advanced, setAdvanced] = useState(false);

  const plan = analysis?.plans[0] ?? null;
  const targetKey = value.target !== "auto" ? value.target : plan?.key ?? null;
  const target = analysis?.bitmaps.find((b) => b.key === targetKey) ?? null;

  return (
    <div className="space-y-5">
      {/* 1. What */}
      <div>
        <label className="flex items-center justify-between text-sm font-medium text-white/80 mb-2" htmlFor="te-text">
          New text
          <Toggle checked={value.enabled} onChange={(b) => onChange({ ...value, enabled: b })} disabled={disabled} label="Replace text" />
        </label>
        <input
          id="te-text"
          type="text"
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value, enabled: true })}
          disabled={disabled}
          placeholder="e.g. 99"
          maxLength={40}
          autoComplete="off"
          className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-2xl font-semibold text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        />
        {!value.enabled && <p className="mt-1.5 text-[11px] text-white/40">Type to start — the stage shows the result live.</p>}
      </div>

      {value.enabled && (
        <>
          {/* 2. Look */}
          <div>
            <div className="text-sm font-medium text-white/80 mb-2">Look</div>
            <div className="grid grid-cols-4 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => setLook({ preset: p.value, ...(p.value !== "auto" && p.value !== "custom" ? LOOK_PRESETS[p.value] : {}) })}
                  className={`flex flex-col items-center gap-1.5 rounded-xl p-2 transition ${value.look.preset === p.value ? "bg-white/10 ring-1 ring-brand-400/70" : "hover:bg-white/5"}`}
                  title={p.value === "auto" ? "Use the colour of the text being replaced" : p.label}
                >
                  <span className="h-7 w-7 rounded-full border border-white/15" style={{ background: p.swatch }} />
                  <span className="text-[10px] text-white/70">{p.label}</span>
                </button>
              ))}
            </div>
            {value.look.preset === "custom" && (
              <div className="mt-3 space-y-3 rounded-xl bg-white/5 p-3">
                <ColorRow label="Colour" value={value.look.color} onChange={(c) => setLook({ color: c })} disabled={disabled} />
                <Checkbox label="Gradient" checked={value.look.gradient} onChange={(b) => setLook({ gradient: b })} disabled={disabled} />
                {value.look.gradient && <ColorRow label="to" value={value.look.secondColor} onChange={(c) => setLook({ secondColor: c })} disabled={disabled} />}
                <Checkbox label="Outline" checked={value.look.stroke} onChange={(b) => setLook({ stroke: b })} disabled={disabled} />
                {value.look.stroke && (
                  <>
                    <ColorRow label="Outline colour" value={value.look.strokeColor} onChange={(c) => setLook({ strokeColor: c })} disabled={disabled} />
                    <Slider label="Outline width" value={Math.round(value.look.strokeWidth * 100)} onChange={(n) => setLook({ strokeWidth: n / 100 })} min={2} max={20} step={1} suffix="%" disabled={disabled} />
                  </>
                )}
              </div>
            )}
          </div>

          {/* 3. Where */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm font-medium text-white/80">Where the text is</span>
              {analyzing && <span className="text-[11px] text-white/40">looking…</span>}
            </div>

            <Status analysis={analysis} guessed={value.regionGuessed} siblings={siblings.length} otherFiles={otherFiles} />

            {analysis && (
              <BitmapGrid
                movie={movie}
                analysis={analysis}
                selected={value.target}
                onPick={(k) => {
                  // Picking a bitmap the diff knows nothing about still needs a
                  // box to drag, so seed one inside that bitmap.
                  const planned = analysis.plans.some((p) => p.key === k);
                  const g = !planned && k !== "auto" ? guessRegion(analysis.bitmaps, k) : null;
                  onChange({ ...value, target: k, region: g ? g.region : null, regionGuessed: !!g });
                }}
              />
            )}

            {target && (
              <div className="mt-3 rounded-xl bg-white/5 p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-white/60">
                    {value.region ? (value.regionGuessed ? "Region is a guess" : "Region set by hand") : plan ? `Detected · ${plan.mode}` : "No region yet"}
                  </span>
                  <span className="font-mono text-white/70">{fmt(value.region ?? plan?.region ?? null)}</span>
                </div>
                <p className="text-[11px] text-white/40">
                  {value.regionGuessed ? "Drag the box on the stage onto the text." : "Drag the box on the stage to adjust it."} It stays on {target.key} ({target.width}×{target.height})
                  {target.sequence ? ` and the other ${target.sequence.length - 1} frames of its sequence` : ""}.
                </p>
                {value.region && plan && !value.regionGuessed && (
                  <button type="button" onClick={() => onChange({ ...value, region: null, regionGuessed: false })} className="text-[11px] text-brand-300 hover:text-brand-200">
                    Reset to detected
                  </button>
                )}
              </div>
            )}

            <button type="button" onClick={() => setAdvanced((a) => !a)} className="mt-3 text-[11px] text-white/50 hover:text-white/80">
              {advanced ? "Hide" : "Show"} advanced
            </button>
            {advanced && (
              <div className="mt-2 space-y-3 rounded-xl bg-white/5 p-3">
                <div>
                  <div className="text-[11px] text-white/60 mb-1">How to edit</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["auto", "swap", "repaint"] as const).map((m) => (
                      <button key={m} type="button" disabled={disabled} onClick={() => onChange({ ...value, mode: m })}
                        className={`rounded-lg px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider transition ${value.mode === m ? "bg-brand-500 text-white" : "bg-white/5 text-white/70 hover:bg-white/10"}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-white/40">swap replaces a bitmap that is only text · repaint paints over a region of a larger bitmap first.</p>
                </div>
                {value.region && (
                  <div className="grid grid-cols-4 gap-2">
                    {(["x", "y", "width", "height"] as const).map((k) => (
                      <label key={k} className="text-[11px] text-white/50">
                        {k}
                        <input type="number" value={Math.round(value.region![k])} disabled={disabled}
                          onChange={(e) => onChange({ ...value, region: { ...value.region!, [k]: Number(e.target.value) } })}
                          className="mt-1 w-full rounded-md bg-white/5 border border-white/10 px-2 py-1 text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/40" />
                      </label>
                    ))}
                  </div>
                )}
                <div>
                  <div className="text-[11px] text-white/60 mb-1">Remove bitmaps</div>
                  <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                    {analysis?.bitmaps.map((b) => (
                      <Checkbox key={b.key} label={`#${b.index} ${b.key} · ${b.width}×${b.height}`} checked={value.remove.includes(b.key)} disabled={disabled}
                        onChange={(on) => onChange({ ...value, remove: on ? [...value.remove, b.key] : value.remove.filter((k) => k !== b.key) })} />
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-white/40">Drops the bitmap and every sprite drawn from it.</p>
                </div>
              </div>
            )}
          </div>

          {error && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 leading-relaxed">{error}</div>}
        </>
      )}
    </div>
  );
}

function Status({ analysis, guessed, siblings, otherFiles }: { analysis: Analysis | null; guessed: boolean; siblings: number; otherFiles: number }) {
  if (!analysis) return null;
  const ok = analysis.plans.length > 0;
  if (guessed) {
    return (
      <div className="rounded-xl px-3 py-2 text-[11px] leading-relaxed bg-amber-500/10 text-amber-200">
        <span className="font-medium">Guessing.</span> With only this file there is nothing to compare, so the box on the stage is a guess — drag it onto the text.
        {siblings === 0 && <> Or add the other files from this set (level-41 … level-49 beside level-50) and it will be found exactly.</>}
      </div>
    );
  }
  const frames = analysis.plans.reduce((n, p) => n + p.keys.length, 0);
  if (ok && analysis.source === "detected" && analysis.confidence === "low") {
    return (
      <div className="rounded-xl px-3 py-2 text-[11px] leading-relaxed bg-amber-500/10 text-amber-200">
        <span className="font-medium">Probably here.</span> {analysis.reason}, but it does not look like clean lettering — check the box on the stage and drag it if it is off.
      </div>
    );
  }
  return (
    <div className={`rounded-xl px-3 py-2 text-[11px] leading-relaxed ${ok ? "bg-emerald-500/10 text-emerald-200" : "bg-amber-500/10 text-amber-200"}`}>
      {ok ? (
        <>
          <span className="font-medium">{analysis.source === "detected" ? "Found text." : analysis.source === "manual" ? "Using your box." : "Found it."}</span> {analysis.reason}
          {analysis.source === "diff" && analysis.sibling && <> — compared with <span className="font-mono">{analysis.sibling}</span>{analysis.siblingsUsed > 1 ? ` and ${analysis.siblingsUsed - 1} more` : ""}</>}.
          {analysis.source === "diff" && frames > 1 && <> Applies to {frames} bitmaps.</>}
          {analysis.source === "detected" && <> If the box is off, drag it.</>}
        </>
      ) : siblings === 0 ? (
        <>
          <span className="font-medium">Can&apos;t tell where the text is yet.</span> Add the other files from this set
          {otherFiles > 0 ? " — the ones loaded don't match this file's design" : ""} (level-41 … level-49 beside level-50), or pick a bitmap below and drag a box on the stage.
        </>
      ) : (
        <>
          <span className="font-medium">Not found.</span> {analysis.reason}. Pick a bitmap below and drag a box on the stage.
        </>
      )}
    </div>
  );
}

function BitmapGrid({ movie, analysis, selected, onPick }: { movie: MovieFile; analysis: Analysis; selected: string; onPick: (k: string) => void }) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const planned = new Set(analysis.plans.map((p) => p.key));
  const items = analysis.bitmaps.filter((b) => b.isBitmap);
  const shown = open ? items : items.filter((b) => planned.has(b.key) || b.key === selected).concat(items.filter((b) => !planned.has(b.key) && b.key !== selected).slice(0, 5));

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      const next: Record<string, string> = {};
      for (const b of shown.slice(0, 60)) {
        if (thumbs[b.key]) { next[b.key] = thumbs[b.key]; continue; }
        const u = await bitmapThumbnail(movie, b.key, 64);
        if (u) { next[b.key] = u; urls.push(u); }
      }
      if (!cancelled) setThumbs((prev) => ({ ...prev, ...next }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movie, analysis, open]);

  return (
    <div className="mt-2">
      <div className="grid grid-cols-4 gap-1.5">
        {shown.map((b) => {
          const isSel = selected === b.key || (selected === "auto" && planned.has(b.key));
          return (
            <button key={b.key} type="button" onClick={() => onPick(selected === b.key ? "auto" : b.key)}
              title={`#${b.index} ${b.key} · ${b.width}×${b.height} · on ${b.frames}/${b.totalFrames} frames${b.diff ? " · differs from siblings" : ""}`}
              className={`rounded-lg p-1 checkerboard border transition ${isSel ? "border-emerald-400 ring-2 ring-emerald-400/30" : "border-white/10 hover:border-white/30"}`}>
              <div className="h-12 w-full grid place-items-center overflow-hidden">
                {thumbs[b.key] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbs[b.key]} alt="" className="max-h-12 max-w-full" draggable={false} />
                ) : <span className="text-[10px] text-white/30">#{b.index}</span>}
              </div>
              <div className="text-[10px] text-white/60 font-mono truncate">#{b.index}{b.diff ? " ✎" : ""}</div>
            </button>
          );
        })}
      </div>
      {items.length > shown.length || open ? (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1.5 text-[11px] text-white/50 hover:text-white/80">
          {open ? "Show fewer" : `Show all ${items.length} bitmaps`}
        </button>
      ) : null}
    </div>
  );
}

/* ---- small controls ---- */

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (b: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-gradient-to-r from-brand-500 to-violet-500" : "bg-white/15"}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

function Slider({ label, value, onChange, min, max, step, suffix, disabled }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; suffix?: string; disabled?: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-white/70">{label}</span>
        <span className="text-xs font-mono text-white/60 tabular-nums">{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} className="mt-1" />
    </div>
  );
}

function ColorRow({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-white/70">{label}</span>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-8 w-10 rounded cursor-pointer bg-transparent border border-white/10" />
        <span className="text-[11px] font-mono text-white/60">{value.toUpperCase()}</span>
      </div>
    </div>
  );
}

function Checkbox({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (b: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-2 cursor-pointer text-xs text-white/70 ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} className="h-4 w-4 accent-brand-500" />
      <span className="truncate">{label}</span>
    </label>
  );
}
