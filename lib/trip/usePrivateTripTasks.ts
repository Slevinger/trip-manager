"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getClientAuth, getDb, getMissingFirebasePublicEnv } from "@/lib/firebase";
import { userPrimaryEmailLower } from "@/lib/auth/userPrimaryEmailLower";
import { savePrivateTripTasks, subscribePrivateTripTasks } from "@/lib/usersFirestore";
import { logCaughtException } from "@/lib/logCaughtException";
import { newId } from "@/lib/canonicalIds";
import type { TripTask } from "@/lib/types/trip";

const LOCAL_KEY = (tripId: string) => `planner-next:private-tasks:${tripId}`;

function loadLocalTasks(tripId: string): TripTask[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY(tripId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is TripTask =>
        t !== null && typeof t === "object" && typeof (t as Record<string, unknown>).id === "string"
    );
  } catch {
    return [];
  }
}

function saveLocalTasks(tripId: string, tasks: TripTask[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_KEY(tripId), JSON.stringify(tasks));
  } catch (e) {
    logCaughtException(e, "usePrivateTripTasks/saveLocalTasks");
  }
}

export interface UsePrivateTripTasksResult {
  tasks: TripTask[];
  addTask: (title: string) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  toggleDone: (id: string) => Promise<void>;
  updateTitle: (id: string, title: string) => Promise<void>;
  changeStatus: (id: string, status: TripTask["status"]) => Promise<void>;
  ready: boolean;
}

export function usePrivateTripTasks(tripId: string): UsePrivateTripTasksResult {
  const [tasks, setTasks] = useState<TripTask[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const useFirestore = Boolean(getDb() && getMissingFirebasePublicEnv().length === 0);
  const auth = getClientAuth();

  useEffect(() => {
    if (!auth) {
      setTasks(loadLocalTasks(tripId));
      setReady(true);
      return () => {};
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setTasks(loadLocalTasks(tripId));
        setReady(true);
      }
    });
    return unsub;
  }, [auth, tripId]);

  useEffect(() => {
    if (!useFirestore || !user) return () => {};
    const email = userPrimaryEmailLower(user);
    if (!email) {
      setTasks(loadLocalTasks(tripId));
      setReady(true);
      return () => {};
    }
    const unsub = subscribePrivateTripTasks(
      email,
      tripId,
      (t) => { setTasks(t); setReady(true); },
      (err) => logCaughtException(err, "usePrivateTripTasks/subscribe")
    );
    return unsub;
  }, [useFirestore, user, tripId]);

  const persist = useCallback(
    async (next: TripTask[]) => {
      setTasks(next);
      const email = userPrimaryEmailLower(user);
      if (useFirestore && email) {
        await savePrivateTripTasks(email, tripId, next).catch((e) =>
          logCaughtException(e, "usePrivateTripTasks/save")
        );
      } else {
        saveLocalTasks(tripId, next);
      }
    },
    [useFirestore, user, tripId]
  );

  const addTask = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      await persist([...tasks, { id: newId(), title: trimmed, status: "todo" }]);
    },
    [tasks, persist]
  );

  const removeTask = useCallback(
    async (id: string) => { await persist(tasks.filter((t) => t.id !== id)); },
    [tasks, persist]
  );

  const toggleDone = useCallback(
    async (id: string) => {
      await persist(
        tasks.map((t) => t.id === id ? { ...t, status: t.status === "done" ? "todo" : "done" } : t)
      );
    },
    [tasks, persist]
  );

  const updateTitle = useCallback(
    async (id: string, title: string) => {
      await persist(tasks.map((t) => (t.id === id ? { ...t, title } : t)));
    },
    [tasks, persist]
  );

  const changeStatus = useCallback(
    async (id: string, status: TripTask["status"]) => {
      await persist(tasks.map((t) => (t.id === id ? { ...t, status } : t)));
    },
    [tasks, persist]
  );

  return { tasks, addTask, removeTask, toggleDone, updateTitle, changeStatus, ready };
}
