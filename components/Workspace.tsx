"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Dropzone from "./Dropzone";
import FilesPanel, { type LoadedFile } from "./FilesPanel";
import Stage, { type StageView } from "./Stage";
import Inspector, { type InspectorTab } from "./Inspector";
import TextEdit from "./TextEdit";
import Controls from "./Controls";
import Watermark from "./Watermark";
import { compressMovieImages, type CompressOptions } from "@/lib/compress";
import { decodeSvga, dedupeImages, encodeSvga, paramsExtraFieldCount, stripParamsMetadata, type MovieFile } from "@/lib/svga";
import { applyWatermark, defaultWatermark, type WatermarkConfig } from "@/lib/watermark";
import { analyzeMovie, applyTextEdit, defaultTextEdit, isSibling, type Analysis, type Rect, type SiblingFile, type TextEditConfig } from "@/lib/text-edit";

type Progress = { done: number; total: number; label: string };

/**
 * The page's brain. Three columns: files, stage, inspector. State flows
 * one way — load → (edit live) → build → download — and the stage always
 * shows the most interesting thing: the edit while you type, the result
 * once it is built.
 */
export default function Workspace() {
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [activeFile, setActiveFile] = useState<File | null>(null);
  const [original, setOriginal] = useState<MovieFile | null>(null);
  const [siblings, setSiblings] = useState<SiblingFile[]>([]);

  const [textEdit, setTextEdit] = useState<TextEditConfig>(defaultTextEdit);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [edited, setEdited] = useState<MovieFile | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const [options, setOptions] = useState<CompressOptions>({ scale: 0.75, quality: 0.8, format: "png", colors: 128, dedupe: true, stripMetadata: false });
  const [watermark, setWatermark] = useState<WatermarkConfig>(defaultWatermark);

  const [result, setResult] = useState<{ movie: MovieFile; bytes: Uint8Array; signature: string } | null>(null);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<StageView>("original");
  const [tab, setTab] = useState<InspectorTab>("text");
  const editRun = useRef(0);
  // Jump to the Edited view the first time an edit appears — and only then.
  // Re-jumping on every keystroke or region drag would pull the stage out
  // from under the user while they adjust the box.
  const jumpedToEdited = useRef(false);

  const decode = async (f: File) => decodeSvga(new Uint8Array(await f.arrayBuffer()));

  const pick = useCallback((target: LoadedFile, all: LoadedFile[]) => {
    setActiveFile(target.file);
    setOriginal(target.movie);
    setSiblings(all.filter((x) => x !== target && isSibling(target.movie, x.movie)).map((x) => ({ name: x.file.name, movie: x.movie })));
    setResult(null);
    setEdited(null);
    setAnalysis(null);
    setEditError(null);
    setTextEdit((t) => ({ ...t, target: "auto", region: null, remove: [] }));
    setView("original");
    jumpedToEdited.current = false;
  }, []);

  const load = useCallback(async (incoming: File[], append: boolean) => {
    setError(null);
    const loaded: LoadedFile[] = [];
    let firstError: string | null = null;
    for (const f of incoming) {
      if (!/\.svga$/i.test(f.name)) continue;
      if (append && files.some((x) => x.file.name === f.name)) continue;
      try {
        loaded.push({ file: f, movie: await decode(f) });
      } catch (e) {
        firstError ??= `${f.name}: ${(e as Error).message}`;
      }
    }
    if (firstError) setError(firstError);
    const all = append ? [...files, ...loaded] : loaded;
    if (!all.length) {
      if (!firstError) setError("No readable .svga files.");
      return;
    }
    setFiles(all);
    if (!append || !activeFile) {
      pick(all[0], all);
      setTextEdit(defaultTextEdit);
    } else {
      const cur = all.find((x) => x.file === activeFile);
      if (cur) setSiblings(all.filter((x) => x !== cur && isSibling(cur.movie, x.movie)).map((x) => ({ name: x.file.name, movie: x.movie })));
    }
  }, [files, activeFile, pick]);

  const clear = useCallback(() => {
    setFiles([]); setActiveFile(null); setOriginal(null); setSiblings([]);
    setTextEdit(defaultTextEdit); setAnalysis(null); setEdited(null); setEditError(null);
    setResult(null); setProgress(null); setError(null); setView("original"); setTab("text");
    jumpedToEdited.current = false;
  }, []);

  // Where is the text? Re-asked when the inputs to that question change.
  useEffect(() => {
    if (!original || !textEdit.enabled) { setAnalysis(null); return; }
    let cancelled = false;
    setAnalyzing(true);
    analyzeMovie(original, siblings, textEdit)
      .then((a) => { if (!cancelled) setAnalysis(a); })
      .catch((e) => { if (!cancelled) setEditError((e as Error).message); })
      .finally(() => { if (!cancelled) setAnalyzing(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original, siblings, textEdit.enabled, textEdit.target, textEdit.mode, textEdit.region]);

  // Live edit, a beat after typing stops.
  useEffect(() => {
    const wants = original && ((textEdit.enabled && textEdit.text.trim()) || textEdit.remove.length);
    if (!wants) {
      setEdited(null);
      setEditError(null);
      jumpedToEdited.current = false;
      if (view === "edited") setView("original");
      return;
    }
    if (textEdit.enabled && !analysis) return;
    const run = ++editRun.current;
    const t = setTimeout(async () => {
      try {
        const { movie } = await applyTextEdit(original!, siblings, textEdit, analysis ?? undefined);
        if (editRun.current !== run) return;
        setEdited(movie);
        setEditError(null);
        if (!jumpedToEdited.current && view !== "result") {
          setView("edited");
          jumpedToEdited.current = true;
        }
      } catch (e) {
        if (editRun.current !== run) return;
        setEdited(null);
        setEditError((e as Error).message);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original, siblings, textEdit, analysis]);

  // A built result belongs to one exact set of inputs; anything else makes it stale.
  const signature = useMemo(
    () => JSON.stringify({ f: activeFile?.name, t: textEdit, o: options, w: watermark, e: edited ? 1 : 0 }),
    [activeFile, textEdit, options, watermark, edited],
  );
  const stale = !!result && result.signature !== signature;

  const build = useCallback(async () => {
    if (!original) return;
    setBuilding(true);
    setError(null);
    setProgress({ done: 0, total: Object.keys(original.images).length, label: "Starting" });
    try {
      let source = original;
      if (textEdit.enabled || textEdit.remove.length) {
        setProgress({ done: 0, total: 1, label: "Replacing text" });
        source = (await applyTextEdit(original, siblings, textEdit, analysis ?? undefined)).movie;
      }
      let next = await compressMovieImages(source, options, (done, total, label) => setProgress({ done, total, label }));
      if (options.dedupe) next = dedupeImages(next).movie;
      if (options.stripMetadata) next = { ...next, paramsBytes: stripParamsMetadata(next.paramsBytes).bytes };
      if (watermark.enabled) {
        setProgress({ done: 1, total: 1, label: "Applying watermark" });
        next = await applyWatermark(next, watermark);
      }
      setProgress({ done: 1, total: 1, label: "Encoding" });
      const bytes = await encodeSvga(next);
      setResult({ movie: next, bytes, signature });
      setView("result");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuilding(false);
      setProgress(null);
    }
  }, [original, siblings, textEdit, analysis, options, watermark, signature]);

  const downloadName = useMemo(() => {
    if (!activeFile) return null;
    const base = activeFile.name.replace(/\.svga$/i, "");
    const tag = textEdit.enabled && textEdit.text.trim() ? `-${textEdit.text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "edited"}` : ".min";
    return `${base}${tag}.svga`;
  }, [activeFile, textEdit]);

  const download = useCallback(() => {
    if (!result || !downloadName) return;
    const url = URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [result, downloadName]);

  // The region box on the stage: the manual region if set, else the detected plan.
  const stageRegion = useMemo(() => {
    if (!textEdit.enabled || !analysis) return null;
    const key = textEdit.target !== "auto" ? textEdit.target : analysis.plans[0]?.key;
    if (!key) return null;
    const info = analysis.bitmaps.find((b) => b.key === key);
    if (!info || !info.placement) return null;
    const rect = textEdit.region ?? analysis.plans.find((p) => p.key === key)?.region ?? null;
    if (!rect) return null;
    return {
      rect,
      detected: !textEdit.region,
      placement: info.placement,
      bitmap: { width: info.width, height: info.height },
      onChange: (r: Rect) => setTextEdit((t) => ({ ...t, target: key, region: r })),
    };
  }, [textEdit, analysis]);

  const metadataFields = useMemo(() => (original ? paramsExtraFieldCount(original.paramsBytes) : 0), [original]);
  const siblingNames = useMemo(() => new Set(siblings.map((s) => s.name)), [siblings]);

  if (!original || !activeFile) {
    return (
      <div className="space-y-4">
        <Dropzone onFiles={(f) => load(f, false)} />
        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}

      <div className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)_340px] items-start">
        <FilesPanel files={files} active={activeFile} siblingNames={siblingNames} onPick={(f) => pick(f, files)} onAdd={(f) => load(f, true)} onClear={clear} disabled={building} />

        <Stage
          movies={{ original, edited, result: result?.movie ?? null }}
          view={view}
          onView={setView}
          watermark={watermark}
          onWatermarkChange={setWatermark}
          region={stageRegion}
          fileName={activeFile.name}
          building={building}
        />

        <Inspector
          tab={tab}
          onTab={setTab}
          active={{ text: textEdit.enabled && !!textEdit.text.trim(), watermark: watermark.enabled, compress: true }}
          panels={{
            text: (
              <TextEdit value={textEdit} onChange={setTextEdit} movie={original} siblings={siblings} otherFiles={files.length - 1} analysis={analysis} analyzing={analyzing} error={editError} disabled={building} />
            ),
            compress: <Controls value={options} onChange={setOptions} disabled={building} metadataFields={metadataFields} bare />,
            watermark: <Watermark value={watermark} onChange={setWatermark} disabled={building} bare />,
          }}
          originalSize={activeFile.size}
          resultSize={result?.bytes.byteLength ?? null}
          stale={stale}
          building={building}
          progress={progress}
          canBuild={!building}
          onBuild={build}
          onDownload={download}
          downloadName={downloadName}
        />
      </div>
    </div>
  );
}
