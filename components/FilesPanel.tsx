"use client";

import { useEffect, useState } from "react";
import type { MovieFile } from "@/lib/svga";
import { formatBytes } from "@/lib/compress";
import { bitmapThumbnail } from "@/lib/text-edit";

export type LoadedFile = { file: File; movie: MovieFile };

type Props = {
  files: LoadedFile[];
  active: File | null;
  /** Names of files that count as siblings of the active one. */
  siblingNames: Set<string>;
  onPick: (f: LoadedFile) => void;
  onAdd: (files: File[]) => void;
  onClear: () => void;
  disabled?: boolean;
};

export default function FilesPanel({ files, active, siblingNames, onPick, onAdd, onClear, disabled }: Props) {
  const [over, setOver] = useState(false);
  return (
    <aside className="glass rounded-2xl flex flex-col min-h-0" aria-label="Files">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="text-sm font-medium text-white">
          Files <span className="text-white/40 font-normal">· {files.length}</span>
        </div>
        <button type="button" onClick={onClear} disabled={disabled} className="text-[11px] text-white/50 hover:text-white transition disabled:opacity-40">
          Clear all
        </button>
      </div>

      <ul className="flex-1 overflow-y-auto max-h-[40vh] lg:max-h-[60vh] p-2 space-y-1">
        {files.map((f) => {
          const isActive = f.file === active;
          const isSibling = siblingNames.has(f.file.name);
          return (
            <li key={f.file.name}>
              <button
                type="button"
                onClick={() => onPick(f)}
                disabled={disabled}
                className={`w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left transition ${
                  isActive ? "bg-white/10 ring-1 ring-brand-400/60" : "hover:bg-white/5"
                }`}
              >
                <Thumb movie={f.movie} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white">{f.file.name}</div>
                  <div className="text-[11px] text-white/40 truncate">
                    {formatBytes(f.file.size)} · {Math.round(f.movie.params.viewBoxWidth)}×{Math.round(f.movie.params.viewBoxHeight)} · {f.movie.params.frames}f
                  </div>
                </div>
                {isActive ? (
                  <span className="shrink-0 rounded-full bg-brand-500/20 text-brand-200 text-[10px] px-2 py-0.5">editing</span>
                ) : isSibling ? (
                  <span className="shrink-0 rounded-full bg-emerald-500/15 text-emerald-300 text-[10px] px-2 py-0.5" title="Same set as the active file — used to find the text">sibling</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <label
        className={`m-2 block rounded-xl border-2 border-dashed px-3 py-3 text-center cursor-pointer transition ${over ? "border-brand-400 bg-brand-500/10" : "border-white/10 hover:border-white/25"} ${disabled ? "opacity-60 pointer-events-none" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onAdd(Array.from(e.dataTransfer.files)); }}
      >
        <input type="file" accept=".svga" multiple className="sr-only" disabled={disabled} onChange={(e) => { onAdd(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        <div className="text-xs font-medium text-white">+ Add files</div>
        <div className="text-[11px] text-white/40 mt-0.5">Drop the rest of the set to find the text automatically</div>
      </label>
    </aside>
  );
}

function Thumb({ movie }: { movie: MovieFile }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    // The first bitmap is usually the base; good enough for a 40px thumb.
    const key = Object.keys(movie.images)[0];
    if (!key) return;
    bitmapThumbnail(movie, key, 80).then((u) => {
      if (cancelled) { if (u) URL.revokeObjectURL(u); return; }
      made = u;
      setUrl(u);
    });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [movie]);
  return (
    <div className="h-10 w-10 shrink-0 rounded-lg checkerboard grid place-items-center overflow-hidden">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="max-h-10 max-w-10" draggable={false} />
      ) : (
        <span className="text-[10px] text-white/30">svga</span>
      )}
    </div>
  );
}
