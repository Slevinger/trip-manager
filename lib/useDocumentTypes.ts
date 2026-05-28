"use client";

import { useEffect, useState, useCallback } from "react";
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  query,
  orderBy,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { BUILTIN_DOCUMENT_TYPES } from "@/lib/types/trip";

const COLLECTION = "documentTypes";

export interface CustomDocumentType {
  id: string;
  label: string;
}

export interface UseDocumentTypesResult {
  customTypes: CustomDocumentType[];
  addCustomType: (label: string) => Promise<void>;
  loading: boolean;
}

export function useDocumentTypes(): UseDocumentTypesResult {
  const [customTypes, setCustomTypes] = useState<CustomDocumentType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const db = getDb();
    if (!db) { setLoading(false); return; }

    const q = query(collection(db, COLLECTION), orderBy("label"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setCustomTypes(
          snap.docs.map((d) => ({ id: d.id, label: d.data().label as string }))
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  const addCustomType = useCallback(async (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    // Normalize label to a safe doc ID: lowercase, spaces → hyphens
    const docId = trimmed.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
    if (!docId) return;
    // Skip if it matches a built-in type key
    if (BUILTIN_DOCUMENT_TYPES.includes(docId as typeof BUILTIN_DOCUMENT_TYPES[number])) return;

    const db = getDb();
    if (!db) return;
    // setDoc with the normalized label as doc ID — idempotent, naturally deduplicates
    await setDoc(doc(db, COLLECTION, docId), { label: trimmed, createdAt: new Date().toISOString() }, { merge: true });
  }, []);

  return { customTypes, addCustomType, loading };
}
