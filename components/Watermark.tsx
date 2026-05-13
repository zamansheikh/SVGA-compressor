"use client";

import { useCallback } from "react";
import {
  defaultTextWatermark,
  type GradientFill,
  type ImageWatermark,
  type TextBackground,
  type TextShadow,
  type TextWatermark,
  type WatermarkAnimation,
  type WatermarkAnimationType,
  type WatermarkConfig,
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
      setSource(defaultTextWatermark);
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

          <Slider
            label="Overall opacity"
            value={Math.round(value.opacity * 100)}
            onChange={(n) => onChange({ ...value, opacity: n / 100 })}
            min={10}
            max={100}
            step={5}
            suffix="%"
            disabled={disabled}
          />

          <AnimationControls
            value={value.animation}
            onChange={(a) => onChange({ ...value, animation: a })}
            disabled={disabled}
          />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Animation                                                            */
/* ------------------------------------------------------------------ */

type AnimOption = { value: WatermarkAnimationType; label: string; group?: string };

const ANIMATION_OPTIONS: AnimOption[] = [
  { value: "none", label: "None" },
  // Stays at its position — no translation, no rotation.
  { value: "fadeIn", label: "Fade in", group: "In place" },
  { value: "fadeOut", label: "Fade out", group: "In place" },
  { value: "pulse", label: "Pulse", group: "In place" },
  { value: "glow", label: "Glow", group: "In place" },
  { value: "blink", label: "Blink", group: "In place" },
  { value: "flash", label: "Flash", group: "In place" },
  { value: "heartbeat", label: "Heartbeat", group: "In place" },
  { value: "strobe", label: "Strobe", group: "In place" },
  { value: "twinkle", label: "Twinkle", group: "In place" },
  { value: "scalePulse", label: "Scale pulse", group: "In place" },
  // Translate or rotate the watermark.
  { value: "slideInLeft", label: "Slide in ← left", group: "Motion" },
  { value: "slideInRight", label: "Slide in → right", group: "Motion" },
  { value: "slideInTop", label: "Slide in ↓ top", group: "Motion" },
  { value: "slideInBottom", label: "Slide in ↑ bottom", group: "Motion" },
  { value: "bounce", label: "Bounce", group: "Motion" },
  { value: "spin", label: "Spin", group: "Motion" },
];

const LOOPABLE: WatermarkAnimationType[] = [
  "pulse",
  "glow",
  "blink",
  "flash",
  "heartbeat",
  "strobe",
  "twinkle",
  "bounce",
  "spin",
  "scalePulse",
];

function AnimationControls({
  value,
  onChange,
  disabled,
}: {
  value: WatermarkAnimation;
  onChange: (v: WatermarkAnimation) => void;
  disabled?: boolean;
}) {
  const showsLoop = LOOPABLE.includes(value.type);
  const inactive = value.type === "none";

  return (
    <div className="border-t border-white/5 pt-4 space-y-3">
      <div>
        <label className="block text-sm font-medium text-white/80 mb-1.5" htmlFor="wm-anim">
          Animation
        </label>
        <select
          id="wm-anim"
          value={value.type}
          onChange={(e) =>
            onChange({ ...value, type: e.target.value as WatermarkAnimationType })
          }
          disabled={disabled}
          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        >
          <option value="none" className="bg-[#0b1024]">
            None
          </option>
          <optgroup label="In place — no movement" className="bg-[#0b1024]">
            {ANIMATION_OPTIONS.filter((o) => o.group === "In place").map((o) => (
              <option key={o.value} value={o.value} className="bg-[#0b1024]">
                {o.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Motion" className="bg-[#0b1024]">
            {ANIMATION_OPTIONS.filter((o) => o.group === "Motion").map((o) => (
              <option key={o.value} value={o.value} className="bg-[#0b1024]">
                {o.label}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {!inactive && (
        <>
          <Slider
            label="Duration"
            value={value.duration}
            onChange={(n) => onChange({ ...value, duration: n })}
            min={1}
            max={120}
            step={1}
            suffix="f"
            disabled={disabled}
          />
          <Slider
            label="Delay"
            value={value.delay}
            onChange={(n) => onChange({ ...value, delay: n })}
            min={0}
            max={120}
            step={1}
            suffix="f"
            disabled={disabled}
          />
          {showsLoop && (
            <Checkbox
              label="Loop for whole animation"
              checked={value.loop}
              onChange={(b) => onChange({ ...value, loop: b })}
              disabled={disabled}
            />
          )}
          <p className="text-[11px] text-white/40 leading-relaxed">
            Durations are in <span className="font-mono">frames</span> of the
            host SVGA — at 20 fps, 24 frames ≈ 1.2 seconds.
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Text watermark — text content + colour + effects + background       */
/* ------------------------------------------------------------------ */

function TextControls({
  value,
  onChange,
  disabled,
}: {
  value: TextWatermark;
  onChange: (v: TextWatermark) => void;
  disabled?: boolean;
}) {
  const setShadow = (next: Partial<TextShadow>) =>
    onChange({ ...value, shadow: { ...value.shadow, ...next } });
  const setGradient = (next: Partial<GradientFill>) =>
    onChange({ ...value, gradient: { ...value.gradient, ...next } });
  const setBg = (next: Partial<TextBackground>) =>
    onChange({ ...value, bg: { ...value.bg, ...next } });
  const setBgGradient = (next: Partial<GradientFill>) =>
    setBg({ gradient: { ...value.bg.gradient, ...next } });

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

      <ColorRow
        label="Text color"
        value={value.color}
        onChange={(c) => onChange({ ...value, color: c })}
        disabled={disabled}
      />

      <Checkbox
        label="Use gradient"
        checked={value.gradient.enabled}
        onChange={(b) => setGradient({ enabled: b })}
        disabled={disabled}
      />
      {value.gradient.enabled && (
        <div className="pl-6 space-y-3 border-l border-white/5">
          <ColorRow
            label="Gradient end"
            value={value.gradient.secondColor}
            onChange={(c) => setGradient({ secondColor: c })}
            disabled={disabled}
          />
          <Slider
            label="Gradient angle"
            value={value.gradient.angle}
            onChange={(n) => setGradient({ angle: n })}
            min={0}
            max={360}
            step={5}
            suffix="°"
            disabled={disabled}
          />
        </div>
      )}

      <Checkbox
        label="Dark outline (legibility)"
        checked={value.stroke}
        onChange={(b) => onChange({ ...value, stroke: b })}
        disabled={disabled}
      />

      <Checkbox
        label="Drop shadow / glow"
        checked={value.shadow.enabled}
        onChange={(b) => setShadow({ enabled: b })}
        disabled={disabled}
      />
      {value.shadow.enabled && (
        <div className="pl-6 space-y-3 border-l border-white/5">
          <ColorRow
            label="Shadow color"
            value={value.shadow.color}
            onChange={(c) => setShadow({ color: c })}
            disabled={disabled}
          />
          <Slider
            label="Blur"
            value={value.shadow.blur}
            onChange={(n) => setShadow({ blur: n })}
            min={0}
            max={60}
            step={1}
            suffix="px"
            disabled={disabled}
          />
          <Slider
            label="Offset X"
            value={value.shadow.offsetX}
            onChange={(n) => setShadow({ offsetX: n })}
            min={-40}
            max={40}
            step={1}
            suffix="px"
            disabled={disabled}
          />
          <Slider
            label="Offset Y"
            value={value.shadow.offsetY}
            onChange={(n) => setShadow({ offsetY: n })}
            min={-40}
            max={40}
            step={1}
            suffix="px"
            disabled={disabled}
          />
        </div>
      )}

      <div className="border-t border-white/5 pt-4 space-y-4">
        <Checkbox
          label="Background pill"
          checked={value.bg.enabled}
          onChange={(b) => setBg({ enabled: b })}
          disabled={disabled}
          strong
        />

        {value.bg.enabled && (
          <div className="pl-6 space-y-3 border-l border-white/5">
            <ColorRow
              label="Background color"
              value={value.bg.color}
              onChange={(c) => setBg({ color: c })}
              disabled={disabled}
            />

            <Checkbox
              label="Background gradient"
              checked={value.bg.gradient.enabled}
              onChange={(b) => setBgGradient({ enabled: b })}
              disabled={disabled}
            />
            {value.bg.gradient.enabled && (
              <div className="pl-6 space-y-3 border-l border-white/5">
                <ColorRow
                  label="Gradient end"
                  value={value.bg.gradient.secondColor}
                  onChange={(c) => setBgGradient({ secondColor: c })}
                  disabled={disabled}
                />
                <Slider
                  label="Gradient angle"
                  value={value.bg.gradient.angle}
                  onChange={(n) => setBgGradient({ angle: n })}
                  min={0}
                  max={360}
                  step={5}
                  suffix="°"
                  disabled={disabled}
                />
              </div>
            )}

            <Slider
              label="Corner radius"
              value={value.bg.radius}
              onChange={(n) => setBg({ radius: n })}
              min={0}
              max={Math.max(40, Math.round(value.fontSize * 1.2))}
              step={1}
              suffix="px"
              disabled={disabled}
            />
            <Slider
              label="Background opacity"
              value={Math.round(value.bg.opacity * 100)}
              onChange={(n) => setBg({ opacity: n / 100 })}
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

/* ------------------------------------------------------------------ */
/* Image watermark                                                     */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Small reusable controls                                              */
/* ------------------------------------------------------------------ */

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

function ColorRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-white/80">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 w-12 rounded cursor-pointer bg-transparent border border-white/10"
        />
        <span className="text-xs font-mono text-white/60 tabular-nums">
          {value.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  strong,
}: {
  label: string;
  checked: boolean;
  onChange: (b: boolean) => void;
  disabled?: boolean;
  strong?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 cursor-pointer ${
        strong ? "text-sm font-medium text-white/80" : "text-xs text-white/70"
      } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 accent-brand-500"
      />
      {label}
    </label>
  );
}
