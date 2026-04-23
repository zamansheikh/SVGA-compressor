"use client";

import { formatBytes } from "@/lib/compress";

type Props = {
  originalSize: number | null;
  compressedSize: number | null;
  progress: { done: number; total: number; label: string } | null;
};

export default function Stats({ originalSize, compressedSize, progress }: Props) {
  const ratio =
    originalSize && compressedSize && originalSize > 0
      ? ((originalSize - compressedSize) / originalSize) * 100
      : null;

  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="text-sm font-medium text-white/80 mb-3">Stats</h3>

      <dl className="space-y-3 text-sm">
        <Row label="Original" value={originalSize != null ? formatBytes(originalSize) : "—"} />
        <Row
          label="Compressed"
          value={compressedSize != null ? formatBytes(compressedSize) : "—"}
          highlight={compressedSize != null}
        />
        <Row
          label="Saved"
          value={
            ratio != null
              ? `${ratio >= 0 ? "−" : "+"}${Math.abs(ratio).toFixed(1)}%`
              : "—"
          }
          tone={ratio != null ? (ratio > 0 ? "good" : "bad") : undefined}
        />
      </dl>

      {progress && progress.total > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px] text-white/60 mb-1.5">
            <span className="truncate">{progress.label}</span>
            <span className="font-mono tabular-nums">
              {progress.done}/{progress.total}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-brand-500 to-violet-500 transition-all"
              style={{
                width: `${Math.min(100, (progress.done / Math.max(1, progress.total)) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
  tone,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  tone?: "good" | "bad";
}) {
  const toneClass =
    tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-red-400" : "text-white";
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-white/60">{label}</dt>
      <dd className={`font-mono tabular-nums ${highlight ? "text-lg font-semibold" : ""} ${toneClass}`}>
        {value}
      </dd>
    </div>
  );
}
