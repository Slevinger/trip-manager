import type { Diff } from "@/lib/stateDiff";

export type JsonChangeAction = {
  id: string;
  ts: number;
  actionType: string;
  scope: "trip" | "draft";
  forward: Diff[];
  reverse: Diff[];
};

