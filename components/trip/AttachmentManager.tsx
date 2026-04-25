"use client";

import { useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getClientStorage } from "@/lib/firebase";
import type { AttachmentFile } from "@/lib/types/trip";

export function AttachmentManager({
  title,
  attachments,
  uploadPathPrefix,
  onChange,
}: {
  title: string;
  attachments: AttachmentFile[];
  uploadPathPrefix: string;
  onChange: (next: AttachmentFile[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickAndUpload(files: FileList | null) {
    if (!files?.length) return;
    const storage = getClientStorage();
    if (!storage) {
      setError("File storage is not configured.");
      return;
    }
    setBusy(true);
    setError(null);
    const uploaded: AttachmentFile[] = [];
    try {
      for (const file of Array.from(files)) {
        const fileId = uuidv4();
        const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
        const path = `${uploadPathPrefix}/${fileId}-${safeName}`;
        const objectRef = ref(storage, path);
        await uploadBytes(objectRef, file, {
          contentType: file.type || "application/octet-stream",
        });
        const url = await getDownloadURL(objectRef);
        uploaded.push({
          id: fileId,
          name: file.name,
          url,
          path,
          size: file.size,
          contentType: file.type || "",
          uploadedAt: new Date().toISOString(),
        });
      }
      onChange([...attachments, ...uploaded]);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
      setBusy(false);
    }
  }

  async function removeAttachment(id: string) {
    const item = attachments.find((a) => a.id === id);
    if (!item) return;
    const storage = getClientStorage();
    setBusy(true);
    setError(null);
    try {
      if (storage && item.path) {
        await deleteObject(ref(storage, item.path));
      }
      onChange(attachments.filter((a) => a.id !== id));
    } catch {
      setError("Delete failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{title}</h3>
        <label className="inline-flex cursor-pointer items-center rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium dark:border-zinc-700 dark:bg-zinc-900">
          {busy ? "Uploading..." : "Attach files"}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => void pickAndUpload(e.target.files)}
          />
        </label>
      </div>

      {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}

      {attachments.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            >
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-blue-700 underline underline-offset-2 dark:text-blue-300"
              >
                {a.name}
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => void removeAttachment(a.id)}
                className="rounded-md border border-red-200 px-2 py-0.5 text-[11px] text-red-700 dark:border-red-900/50 dark:text-red-300"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">No files attached yet.</p>
      )}
    </section>
  );
}
