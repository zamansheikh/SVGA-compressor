"use client";

import { useCallback, useRef, useState } from "react";

type Props = {
  onFile: (file: File) => void;
  disabled?: boolean;
};

export default function Dropzone({ onFile, disabled }: Props) {
  const [isOver, setIsOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || !files.length) return;
      const file = files[0];
      if (!/\.svga$/i.test(file.name)) {
        alert("Please choose a .svga file. SVG files are not supported by this tool.");
        return;
      }
      onFile(file);
    },
    [onFile],
  );

  return (
    <label
      className={`relative block w-full cursor-pointer transition ${
        disabled ? "opacity-60 pointer-events-none" : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".svga"
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled}
      />
      <div
        className={`rounded-3xl border-2 border-dashed transition p-8 sm:p-12 text-center glass ${
          isOver ? "border-brand-400 bg-brand-500/10" : "border-white/10 hover:border-white/20"
        }`}
      >
        <div className="mx-auto h-14 w-14 rounded-2xl bg-gradient-to-br from-brand-500 to-violet-500 grid place-items-center shadow-lg shadow-brand-500/30">
          <svg viewBox="0 0 24 24" className="h-7 w-7 fill-white">
            <path d="M12 3a1 1 0 0 1 1 1v9.586l3.293-3.293a1 1 0 1 1 1.414 1.414l-5 5a1 1 0 0 1-1.414 0l-5-5a1 1 0 1 1 1.414-1.414L11 13.586V4a1 1 0 0 1 1-1Z" />
            <path d="M4 17a1 1 0 0 1 1 1v2h14v-2a1 1 0 1 1 2 0v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
          </svg>
        </div>
        <h2 className="mt-5 text-lg sm:text-xl font-semibold text-white">
          Drop your <span className="gradient-text">.svga</span> file here
        </h2>
        <p className="mt-1 text-sm text-white/60">or tap to browse — files never leave your device</p>

        <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          100% client-side · No uploads
        </div>
      </div>
    </label>
  );
}
