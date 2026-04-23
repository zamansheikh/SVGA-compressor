"use client";

import type { CompressOptions } from "@/lib/compress";

type Props = {
  value: CompressOptions;
  onChange: (v: CompressOptions) => void;
  disabled?: boolean;
};

export default function Controls({ value, onChange, disabled }: Props) {
  return (
    <div className="glass rounded-2xl p-5 space-y-5">
      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="quality" className="text-sm font-medium text-white/80">
            Quality
          </label>
          <span className="text-xs font-mono text-white/60 tabular-nums">
            {Math.round(value.quality * 100)}
          </span>
        </div>
        <input
          id="quality"
          type="range"
          min={10}
          max={100}
          step={1}
          value={Math.round(value.quality * 100)}
          onChange={(e) => onChange({ ...value, quality: Number(e.target.value) / 100 })}
          disabled={disabled || value.format === "png"}
          className="mt-2"
        />
        <p className="mt-1.5 text-[11px] text-white/40">
          Lower = smaller file. Doesn't apply when output is PNG.
        </p>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="scale" className="text-sm font-medium text-white/80">
            Scale
          </label>
          <span className="text-xs font-mono text-white/60 tabular-nums">
            {Math.round(value.scale * 100)}%
          </span>
        </div>
        <input
          id="scale"
          type="range"
          min={25}
          max={100}
          step={5}
          value={Math.round(value.scale * 100)}
          onChange={(e) => onChange({ ...value, scale: Number(e.target.value) / 100 })}
          disabled={disabled}
          className="mt-2"
        />
        <p className="mt-1.5 text-[11px] text-white/40">
          Resamples each bitmap. 50% gives ~4× smaller pixels.
        </p>
      </div>

      <div>
        <span className="block text-sm font-medium text-white/80 mb-2">Image format</span>
        <div className="grid grid-cols-3 gap-2">
          {(["webp", "png", "jpeg"] as const).map((f) => (
            <button
              key={f}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...value, format: f })}
              className={`rounded-lg px-3 py-2 text-xs font-medium uppercase tracking-wider transition ${
                value.format === f
                  ? "bg-gradient-to-r from-brand-500 to-violet-500 text-white shadow-lg shadow-brand-500/30"
                  : "bg-white/5 text-white/70 hover:bg-white/10"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-white/40">
          WebP is smallest with alpha. PNG is lossless. JPEG drops transparency.
        </p>
      </div>
    </div>
  );
}
