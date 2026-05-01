import type { Trip, TripStep } from "@/lib/types/trip";

/**
 * When Firestore is newer than a local snapshot but the snapshot had unsaved edits,
 * fold local changes into the remote document without treating the result as dirty:
 * remote wins on overlapping fields (`{ ...localStep, ...remoteStep }`), local-only
 * steps and attachments are kept.
 */
export function mergeNewerRemoteWithLocalDraft(remote: Trip, local: Trip): Trip {
  const remoteById = new Map(remote.steps.map((s) => [s.id, s] as const));
  const mergedSteps: TripStep[] = [];
  const seen = new Set<string>();

  for (const rs of remote.steps) {
    const ls = local.steps.find((x) => x.id === rs.id);
    mergedSteps.push(ls ? ({ ...ls, ...rs } as TripStep) : rs);
    seen.add(rs.id);
  }
  for (const ls of local.steps) {
    if (!seen.has(ls.id)) mergedSteps.push(ls);
  }

  const remoteAttIds = new Set(remote.tripAttachments.map((a) => a.id));
  const extraAttachments = local.tripAttachments.filter((a) => !remoteAttIds.has(a.id));

  return {
    ...remote,
    steps: mergedSteps,
    tripAttachments: [...remote.tripAttachments, ...extraAttachments],
  };
}
