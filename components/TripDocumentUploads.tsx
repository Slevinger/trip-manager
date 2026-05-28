"use client";

import { useRef, useState } from "react";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getClientStorage } from "@/lib/firebase";
import type { Trip, TripDocument } from "@/lib/types/trip";
import { useDocumentTypes } from "@/lib/useDocumentTypes";

const BUILTIN_OPTIONS = [
  { value: "passport", label: "Passport" },
  { value: "visa", label: "Visa" },
  { value: "insurance", label: "Insurance" },
  { value: "license", label: "License" },
  { value: "medical", label: "Medical" },
  { value: "other", label: "Other" },
];

const ADD_NEW_SENTINEL = "__add_new__";

function newDocId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function withUpdatedAt(trip: Trip): Trip {
  return { ...trip, updatedAt: new Date().toISOString() };
}

export function TripDocumentUploads({
  trip,
  canUpload,
  disabledHint,
  onPersist,
}: {
  trip: Trip;
  /** Cloud trip + signed-in user + Storage configured. */
  canUpload: boolean;
  disabledHint?: string;
  onPersist: (next: Trip) => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docs = trip.documents ?? [];
  const { customTypes, addCustomType } = useDocumentTypes();
  // docId → new-type input value when user picks "Add type…"
  const [addingTypeFor, setAddingTypeFor] = useState<Record<string, string>>({});

  async function pickAndUpload(files: FileList | null) {
    if (!files?.length) return;
    if (!canUpload) {
      setError(disabledHint ?? "Uploads are not available.");
      return;
    }
    const storage = getClientStorage();
    if (!storage) {
      setError("Firebase Storage is not configured (check NEXT_PUBLIC_FIREBASE_* including storage bucket).");
      return;
    }
    setBusy(true);
    setError(null);
    const prefix = `canonicalTrips/${trip.id}/documents`;
    let nextDocs = [...docs];
    try {
      for (const file of Array.from(files)) {
        const fileId = newDocId();
        const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
        const storagePath = `${prefix}/${fileId}-${safeName}`;
        const objectRef = ref(storage, storagePath);
        await uploadBytes(objectRef, file, {
          contentType: file.type || "application/octet-stream",
        });
        const url = await getDownloadURL(objectRef);
        const doc: TripDocument = {
          id: fileId,
          title: file.name,
          type: "other",
          url,
          storagePath,
        };
        nextDocs = [...nextDocs, doc];
      }
      await onPersist(withUpdatedAt({ ...trip, documents: nextDocs }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
      setBusy(false);
    }
  }

  async function setDocType(id: string, type: string) {
    if (type === ADD_NEW_SENTINEL) {
      setAddingTypeFor((prev) => ({ ...prev, [id]: "" }));
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const nextDocs = docs.map((d) => (d.id === id ? { ...d, type } : d));
      await onPersist(withUpdatedAt({ ...trip, documents: nextDocs }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmNewType(docId: string) {
    const label = (addingTypeFor[docId] ?? "").trim();
    if (!label) { setAddingTypeFor((prev) => { const n = { ...prev }; delete n[docId]; return n; }); return; }
    await addCustomType(label);
    setAddingTypeFor((prev) => { const n = { ...prev }; delete n[docId]; return n; });
    await setDocType(docId, label);
  }

  async function downloadDocument(doc: TripDocument) {
    if (!doc.url) {
      setError("This document has no download URL yet.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(doc.url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = doc.title?.trim() || "document";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeDocument(id: string) {
    const item = docs.find((d) => d.id === id);
    if (!item) return;
    const storage = getClientStorage();
    setBusy(true);
    setError(null);
    try {
      if (storage && item.storagePath) {
        await deleteObject(ref(storage, item.storagePath));
      }
      const nextDocs = docs.filter((d) => d.id !== id);
      await onPersist(withUpdatedAt({ ...trip, documents: nextDocs }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
          Trip files (passports, tickets, reservations)
        </h3>
        <label
          className={`inline-flex cursor-pointer items-center rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium dark:border-zinc-700 dark:bg-zinc-900 ${
            !canUpload || busy ? "cursor-not-allowed opacity-50" : ""
          }`}
        >
          {busy ? "Working…" : "Upload files"}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            disabled={busy || !canUpload}
            onChange={(e) => void pickAndUpload(e.target.files)}
          />
        </label>
      </div>

      {!canUpload && disabledHint ? (
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{disabledHint}</p>
      ) : null}

      {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}

      {docs.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            >
              {addingTypeFor[d.id] !== undefined ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => { e.preventDefault(); void confirmNewType(d.id); }}
                >
                  <input
                    autoFocus
                    className="w-24 rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-900"
                    placeholder="Type name…"
                    value={addingTypeFor[d.id]}
                    onChange={(e) => setAddingTypeFor((prev) => ({ ...prev, [d.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Escape") setAddingTypeFor((prev) => { const n = { ...prev }; delete n[d.id]; return n; }); }}
                  />
                  <button type="submit" className="rounded-md border border-zinc-200 px-1.5 py-0.5 text-[11px] font-medium dark:border-zinc-600">OK</button>
                </form>
              ) : (
                <select
                  className="max-w-[7.5rem] rounded-md border border-zinc-200 bg-white px-1 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                  value={d.type}
                  disabled={busy}
                  onChange={(e) => void setDocType(d.id, e.target.value)}
                  aria-label="Document type"
                >
                  {BUILTIN_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                  {customTypes.length > 0 && (
                    <optgroup label="Custom">
                      {customTypes.map((t) => (
                        <option key={t.id} value={t.label}>{t.label}</option>
                      ))}
                    </optgroup>
                  )}
                  <option value={ADD_NEW_SENTINEL}>＋ Add type…</option>
                </select>
              )}
              {d.url ? (
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-blue-700 underline underline-offset-2 dark:text-blue-300"
                >
                  {d.title || "Untitled"}
                </a>
              ) : (
                <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">
                  {d.title || "Untitled"}
                </span>
              )}
              {d.url ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void downloadDocument(d)}
                  className="shrink-0 rounded-md border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-800 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-100"
                >
                  Download
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void removeDocument(d.id)}
                className="rounded-md border border-red-200 px-2 py-0.5 text-[11px] text-red-700 disabled:opacity-40 dark:border-red-900/50 dark:text-red-300"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">No documents yet.</p>
      )}
    </section>
  );
}
