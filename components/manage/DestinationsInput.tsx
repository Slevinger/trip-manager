"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { PlaceSearchInput } from "@/components/PlaceSearchInput";
import type { PlaceSearchHit, PlaceSearchPickPayload } from "@/lib/places/types";
import type { Destination } from "@/lib/types/trip";
import type { TripGroupedPlacePicks } from "@/lib/tripLocationCatalog";

const CreateDestinationDialog = dynamic(
  () =>
    import("@/components/manage/CreateDestinationDialog").then((m) => ({
      default: m.CreateDestinationDialog,
    })),
  { ssr: false }
);

export type DestinationsInputProps = {
  value: string;
  onChange: (location: string) => void;
  /**
   * After choosing a trip registry row (immediate) or saving a new destination from the map dialog
   * (search row or “new destination” row).
   */
  onPick?: (hit: PlaceSearchPickPayload) => void;
  /** Merge the new registry row into trip state before `onPick` runs on save. */
  onRegisterNewDestination: (d: Destination) => void;
  /** Trip destinations grouped for the dropdown (stay blocks, then other steps); address search in the same list. */
  tripPlaceGrouped: TripGroupedPlacePicks;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  autoFocus?: boolean;
  lang?: string;
  listboxClassName?: string;
};

/**
 * Trip-first place autocomplete: this trip’s destination rows (grouped by stay where helpful), then
 * remote address search. Picking a **trip** row applies it at once. Picking a **search** row (or
 * “new destination” when nothing matches) opens `CreateDestinationDialog`; after save, the new row
 * is registered and returned via `onPick`.
 */
export function DestinationsInput({
  value,
  onChange,
  onPick,
  onRegisterNewDestination,
  tripPlaceGrouped,
  placeholder,
  className,
  disabled,
  id,
  autoFocus,
  lang,
  listboxClassName,
}: DestinationsInputProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createSeed, setCreateSeed] = useState("");
  const [createPrefillHit, setCreatePrefillHit] = useState<PlaceSearchPickPayload | null>(null);

  return (
    <>
      <PlaceSearchInput
        value={value}
        onChange={onChange}
        onPick={onPick}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        id={id}
        autoFocus={autoFocus}
        lang={lang}
        tripPlaceGrouped={tripPlaceGrouped}
        listboxClassName={listboxClassName}
        allowCreateDestination
        onRequestCreateDestination={(q) => {
          setCreatePrefillHit(null);
          setCreateSeed(q);
          setCreateOpen(true);
        }}
        onRemoteSearchPick={(hit: PlaceSearchHit) => {
          setCreatePrefillHit({
            label: hit.label,
            lat: hit.lat,
            lng: hit.lng,
            ...(hit.title ? { title: hit.title } : {}),
            ...(hit.description ? { description: hit.description } : {}),
          });
          setCreateSeed(hit.label);
          setCreateOpen(true);
        }}
      />
      <CreateDestinationDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setCreatePrefillHit(null);
            setCreateSeed("");
          }
        }}
        initialQuery={createSeed}
        initialSearchHit={createPrefillHit}
        onSave={(d) => {
          onRegisterNewDestination(d);
          onChange(d.location);
          onPick?.({
            label: d.location,
            lat: d.coordinates!.lat,
            lng: d.coordinates!.lon,
            title: d.title,
            description: d.description,
            destinationId: d.id,
          });
        }}
      />
    </>
  );
}
