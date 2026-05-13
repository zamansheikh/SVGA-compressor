"use client";

import { useCallback } from "react";
import type {
  ImageWatermark,
  TextWatermark,
  WatermarkConfig,
} from "@/lib/watermark";

type Props = {
  value: WatermarkConfig;
  onChange: (v: WatermarkConfig) => void;
  disabled?: boolean;
};

export default function Watermark({ value, onChange, disabled }: Props) {
  const setSource = (next: TextWatermark | ImageWatermark) =>
    onChange({ ...value, source: next });

  const setKind = (kind: "text" | "image") => {
    if (kind === value.source.kind) return;
    if (kind === "text") {
      setSource({
        kind: "text",
        text: "© Your Brand",
        fontSize: 32,
        color: "#ffffff",
        stroke: true,
        bg: false,
        bgColor: "#000000",
        bgOpacity: 0.5,
      });
    } else {
      setSource({
        kind: "image",
        imageBytes: new Uint8Array(),
        mime: "image/png",
        widthFraction: 0.2,
      });
    }
  };

  const onImageFile = useCallback(
    async (file: File) => {
      const buf = new Uint8Array(await file.arrayBuffer());
      setSource({
        kind: "image",
        imageBytes: buf,
        mime: file.type || "image/png",
        widthFraction:
          value.source.kind === "image" ? value.source.widthFraction : 0.2,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value.source],
  );

  return (
    <div className="glass rounded-2xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-white">Watermark</h3>
          <p className="text-[11px] text-white/40 mt-0.5">
            Added as a new sprite on top of every frame.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value.enabled}
          disabled={disabled}
          onClick={() => onChange({ ...value, enabled: !value.enabled })}
          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition ${
            value.enabled ? "bg-gradient-to-r from-brand-500 to-violet-500" : "bg-white/15"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              value.enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {value.enabled && (
        <>
          {/* Kind tabs */}
          <div className="grid grid-cols-2 gap-2">
            {(["text", "image"] as const).map((k) => (
              <button
                key={k}
                type="button"
                disabled={disabled}
                onClick={() => setKind(k)}
                className={`rounded-lg px-3 py-2 text-xs font-medium uppercase tracking-wider transition ${
                  value.source.kind === k
                    ? "bg-gradient-to-r from-brand-500 to-violet-500 text-white shadow-lg shadow-brand-500/30"
                    : "bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                {k}
              </button>
            ))}
          </div>

          {/* Source-specific controls */}
          {value.source.kind === "text" ? (
            <TextControls value={value.source} onChange={setSource} disabled={disabled} />
          ) : (
            <ImageControls
              value={value.source}
              onChange={setSource}
              onFile={onImageFile}
              disabled={disabled}
            />
          )}

          {/* Position readout */}
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-white/80">Position</span>
            {value.position === "custom" ? (
              <span className="text-[11px] font-mono text-brand-300 tabular-nums">
                {Math.round(value.x)}, {Math.round(value.y)}
              </span>
            ) : (
              <span className="text-[11px] text-white/40 capitalize">
                {value.position.replace("-", " ")}
              </span>
            )}
          </div>
          <p className="-mt-3 text-[11px] text-white/40 leading-relaxed">
            Drag the preview to move it, or focus it and use arrow keys
            (Shift = 10px).
          </p>

          {/* Opacity */}
          <Slider
            label="Opacity"
            value={Math.round(value.opacity * 100)}
            onChange={(n) => onChange({ ...value, opacity: n / 100 })}
            min={10}
            max={100}
            step={5}
            suffix="%"
            disabled={disabled}
          />
        </>
      )}
    </div>
  );
}

function TextControls({
  value,
  onChange,
  disabled,
}: {
  value: TextWatermark;
  onChange: (v: TextWatermark) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-white/80 mb-2" htmlFor="wm-text">
          Text
        </label>
        <input
          id="wm-text"
          type="text"
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          disabled={disabled}
          placeholder="© Your Brand"
          maxLength={120}
          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        />
      </div>

      <Slider
        label="Font size"
        value={value.fontSize}
        onChange={(n) => onChange({ ...value, fontSize: n })}
        min={12}
        max={140}
        step={2}
        suffix="px"
        disabled={disabled}
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-white/60 mb-1.5" htmlFor="wm-color">
            Text color
          </label>
          <div className="flex items-center gap-2">
            <input
              id="wm-color"
              type="color"
              value={value.color}
              onChange={(e) => onChange({ ...value, color: e.target.value })}
              disabled={disabled}
              className="h-9 w-12 rounded cursor-pointer bg-transparent border border-white/10"
            />
            <span className="text-xs font-mono text-white/60">{value.color.toUpperCase()}</span>
          </div>
        </div>
        <div>
          <label className="flex items-center gap-2 mt-7 text-xs text-white/70 cursor-pointer">
            <input
              type="checkbox"
              checked={value.stroke}
              onChange={(e) => onChange({ ...value, stroke: e.target.checked })}
              disabled={disabled}
              className="h-4 w-4 accent-brand-500"
            />
            Dark outline (legibility)
          </label>
        </div>
      </div>

      <div className="border-t border-white/5 pt-4">
        <label className="flex items-center gap-2 text-sm font-medium text-white/80 cursor-pointer">
          <input
            type="checkbox"
            checked={value.bg}
            onChange={(e) => onChange({ ...value, bg: e.target.checked })}
            disabled={disabled}
            className="h-4 w-4 accent-brand-500"
          />
          Background pill
        </label>

        {value.bg && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-xs text-white/60 mb-1.5" htmlFor="wm-bg-color">
                Background color
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="wm-bg-color"
                  type="color"
                  value={value.bgColor}
                  onChange={(e) => onChange({ ...value, bgColor: e.target.value })}
                  disabled={disabled}
                  className="h-9 w-12 rounded cursor-pointer bg-transparent border border-white/10"
                />
                <span className="text-xs font-mono text-white/60">
                  {value.bgColor.toUpperCase()}
                </span>
              </div>
            </div>
            <Slider
              label="Background opacity"
              value={Math.round(value.bgOpacity * 100)}
              onChange={(n) => onChange({ ...value, bgOpacity: n / 100 })}
              min={0}
              max={100}
              step={5}
              suffix="%"
              disabled={disabled}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ImageControls({
  value,
  onChange,
  onFile,
  disabled,
}: {
  value: ImageWatermark;
  onChange: (v: ImageWatermark) => void;
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  const hasImage = value.imageBytes.byteLength > 0;
  return (
    <div className="space-y-4">
      <label
        className={`block rounded-lg border-2 border-dashed transition cursor-pointer ${
          hasImage
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-white/10 hover:border-white/20"
        } ${disabled ? "opacity-60 pointer-events-none" : ""}`}
      >
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
        <div className="px-4 py-5 text-center">
          {hasImage ? (
            <>
              <div className="text-xs text-emerald-300 font-medium">Logo loaded</div>
              <div className="text-[11px] text-white/50 mt-0.5">
                {(value.imageBytes.byteLength / 1024).toFixed(1)} KB · click to replace
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-white">Upload logo</div>
              <div className="text-[11px] text-white/50 mt-0.5">
                PNG, JPEG, or WebP — transparent PNG recommended
              </div>
            </>
          )}
        </div>
      </label>

      <Slider
        label="Size"
        value={Math.round(value.widthFraction * 100)}
        onChange={(n) => onChange({ ...value, widthFraction: n / 100 })}
        min={5}
        max={50}
        step={1}
        suffix="% of width"
        disabled={disabled || !hasImage}
      />
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-white/80">{label}</span>
        <span className="text-xs font-mono text-white/60 tabular-nums">
          {value}
          {suffix && <span className="text-white/40 ml-0.5">{suffix}</span>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="mt-2"
      />
    </div>
  );
}
