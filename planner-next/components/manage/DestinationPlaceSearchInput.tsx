"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { PlaceSearchInput } from "@/components/PlaceSearchInput";

const CreateDestinationDialog = dynamic(
  () =>
    import("@/components/manage/CreateDestinationDialog").then((m) => m.CreateDestinationDialog),
  { ssr: false }
);
import type { PlaceSearchPickPayload } from "@/lib/places/types";
import type { Destination } from "@/lib/types/trip";
import type { TripPlacePick } from "@/lib/tripLocationCatalog";

type DestinationPlaceSearchInputProps = {
  value: string;
  onChange: (location: string) => void;
  onPick?: (hit: PlaceSearchPickPayload) => void;
  /** New registry rows from the create dialog — parent should merge into trip destination state. */
  onRegisterNewDestination: (d: Destination) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  autoFocus?: boolean;
  lang?: string;
  localPicks?: TripPlacePick[];
};

export function DestinationPlaceSearchInput({
  value,
  onChange,
  onPick,
  onRegisterNewDestination,
  placeholder,
  className,
  disabled,
  id,
  autoFocus,
  lang,
  localPicks,
}: DestinationPlaceSearchInputProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createSeed, setCreateSeed] = useState("");

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
        localPicks={localPicks}
        allowCreateDestination
        onRequestCreateDestination={(q) => {
          setCreateSeed(q);
          setCreateOpen(true);
        }}
      />
      <CreateDestinationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialQuery={createSeed}
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
