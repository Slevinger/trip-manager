import type { Trip, TripComment } from "@/lib/types/trip";

export function nextCommentId(existing: TripComment[]): string {
  let n = existing.length + 1;
  while (existing.some((c) => c.id === `c-${n}`)) n += 1;
  return `c-${n}`;
}

export function addComment(
  trip: Trip,
  input: Omit<TripComment, "id" | "createdAt">
): Trip {
  const list = trip.comments ?? [];
  const next: TripComment = {
    ...input,
    id: nextCommentId(list),
    createdAt: new Date().toISOString(),
  };
  return {
    ...trip,
    comments: [...list, next],
    updatedAt: new Date().toISOString(),
  };
}

export function setCommentResolved(trip: Trip, commentId: string, resolved: boolean): Trip {
  const list = trip.comments ?? [];
  return {
    ...trip,
    comments: list.map((c) => (c.id === commentId ? { ...c, resolved } : c)),
    updatedAt: new Date().toISOString(),
  };
}

export function toggleCommentReaction(
  trip: Trip,
  commentId: string,
  reactorIdLower: string
): Trip {
  const id = reactorIdLower.trim().toLowerCase();
  if (!id) return trip;
  const list = trip.comments ?? [];
  return {
    ...trip,
    comments: list.map((c) => {
      if (c.id !== commentId) return c;
      const reactions = c.reactions ?? [];
      return {
        ...c,
        reactions: reactions.includes(id)
          ? reactions.filter((r) => r !== id)
          : [...reactions, id],
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

export function deleteComment(trip: Trip, commentId: string): Trip {
  const list = trip.comments ?? [];
  return {
    ...trip,
    // Remove the comment + any direct replies to it.
    comments: list.filter((c) => c.id !== commentId && c.parentId !== commentId),
    updatedAt: new Date().toISOString(),
  };
}
