"use client";

import type { CompressOptions } from "@/lib/compress";

type Props = {
  value: CompressOptions;
  onChange: (v: CompressOptions) => void;
  disabled?: boolean;
};

export default function Controls({ value, onChange, disabled }: Props) {
  const isPng = value.format === "png";
  const isLossless = isPng && value.colors === 0;

  return (
    <div className="glass rounded-2xl p-5 space-y-5">
      <div>
        <span className="block text-sm font-medium text-white/80 mb-2">Image format</span>
        <div className="grid grid-cols-3 gap-2">
          {(["png", "webp", "jpeg"] as const).map((f) => (
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
          PNG is recommended — it's the only format every SVGA player supports.
        </p>
        {!isPng && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 leading-relaxed">
            <span className="font-semibold">Heads up:</span>{" "}
            Most native SVGA players (Android / iOS) only decode PNG bitmaps.
            A {value.format.toUpperCase()} output may fail to play in your player.
            Use PNG unless you know your player supports {value.format.toUpperCase()}.
          </div>
        )}
      </div>

      {isPng ? (
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="colors" className="text-sm font-medium text-white/80">
              PNG palette
            </label>
            <span className="text-xs font-mono text-white/60 tabular-nums">
              {isLossless ? "lossless" : `${value.colors} colors`}
            </span>
          </div>
          <input
            id="colors"
            type="range"
            min={0}
            max={256}
            step={8}
            value={value.colors}
            onChange={(e) => onChange({ ...value, colors: Number(e.target.value) })}
            disabled={disabled}
            className="mt-2"
          />
          <p className="mt-1.5 text-[11px] text-white/40">
            0 = full 24-bit quality. 256 = near-lossless palette (big size win).
            32–64 is often perfectly fine for gift animations.
          </p>
        </div>
      ) : (
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
            disabled={disabled}
            className="mt-2"
          />
          <p className="mt-1.5 text-[11px] text-white/40">
            Lower = smaller file.
          </p>
        </div>
      )}

      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="scale" className="text-sm font-medium text-white/80">
            Detail
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
          Lower = softer, more compressible bitmaps. Pixel dimensions are
          always preserved, so the output plays identically to the original
          in every SVGA player — no position or size changes.
        </p>
      </div>
    </div>
  );
}
