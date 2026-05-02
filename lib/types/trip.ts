/** Canonical trip domain: ISO datetimes, step intervals, travelers, viewers, tasks, documents. */

export type ISODateString = string;

export interface Coordinates {
  lat: number;
  lon: number;
}

/**
 * A resolved place on the trip. Prefer filling all fields; {@link coordinates} are required for map
 * geometry when this destination is used as a line endpoint (transit legs, pins).
 */
export interface Destination {
  id: string;
  title: string;
  /** Full address / search line (Photon label). */
  location: string;
  /** Human context: locality, region, or same as location when unknown. */
  description: string;
  coordinates?: Coordinates;
}

export type CurrencyCode = "ILS" | "USD" | "EUR" | "THB" | string;

export interface Money {
  amount: number;
  currency: CurrencyCode;
}

/** Who may change the trip in Manage (and similar). Use {@link TripViewer} for read-only people. */
export type TravelerRole = "owner" | "editor";

/** View-only party: listed on the trip but not treated as a traveler; app / hosting rules should restrict them to View. */
export interface TripViewer {
  id: string;
  name: string;
  email?: string;
}

/** Profile defaults live on `users/{emailLower}`; optional per-trip overrides on {@link Traveler}. */
export interface UserPreferences {
  hobbies: string[];
  /** Values from {@link ActivityType} keys, plus arbitrary custom strings. */
  activities: string[];
  lifestyle: string[];
}

export interface Traveler {
  id: string;
  name: string;
  email?: string;
  role?: TravelerRole;
  /** Per-trip override per category; missing keys fall back to profile defaults. */
  preferences?: Partial<UserPreferences>;
}

export type BookingStatus =
  | "idea"
  | "planned"
  | "reserved"
  | "booked"
  | "cancelled";

export interface BookingInfo {
  status: BookingStatus;
  provider?: string;
  confirmationNumber?: string;
  bookingUrl?: string;
  cancellationDeadline?: ISODateString;
  refundable?: boolean;
  notes?: string;
}

export interface Attachment {
  id: string;
  title: string;
  url: string;
  type?: "booking" | "ticket" | "passport" | "insurance" | "other";
}

export interface TripBudget {
  totalBudget?: Money;
  categories?: {
    hotels?: Money;
    transport?: Money;
    food?: Money;
    activities?: Money;
    insurance?: Money;
    shopping?: Money;
    other?: Money;
  };
}

export interface BaseStepInterval {
  id: string;
  title: string;
  comment?: string;
  startTime: ISODateString;
  endTime: ISODateString;
  price?: Money;
  booking?: BookingInfo;
  attachments?: Attachment[];
}

export type StayType =
  | "resort"
  | "b&b"
  | "hotel"
  | "bungalow"
  | "airbnb"
  | "villa"
  | "hostel"
  | "other";

export interface StayStepInterval extends BaseStepInterval {
  intervalType: "stay";
  stayType: StayType;
  /** Registry id when this period has its own pin; see {@link Trip#destinations}. */
  destinationId?: string;
  /** Address / place text for this stay period only. */
  location?: string;
  /** Geocode for this period (map pin); when omitted, use registry {@link StayStepInterval#destinationId} or step default. */
  coordinates?: Coordinates;
  checkInTime?: ISODateString;
  checkOutTime?: ISODateString;
  nights?: number;
}

export type TransitType =
  | "flight"
  | "ferry"
  | "speed_boat"
  | "minivan"
  | "taxi"
  | "train"
  | "bus"
  | "walk"
  | "rental_car"
  | "other";

export interface TransitStepInterval extends BaseStepInterval {
  intervalType: "transit";
  transitType: TransitType;
  /** Start of leg — id in {@link Trip#destinations}. */
  fromDestinationId?: string;
  /** End of leg — id in {@link Trip#destinations}. */
  toDestinationId?: string;
  operatorName?: string;
  departureTerminal?: string;
  arrivalTerminal?: string;
}

export type ActivityType =
  | "tour"
  | "restaurant"
  | "museum"
  | "gallery"
  | "theater"
  | "concert"
  | "festival"
  | "market"
  | "shopping"
  | "nightlife"
  | "beach"
  | "snorkeling"
  | "diving"
  | "surfing"
  | "kayaking"
  | "sailing"
  | "hike"
  | "climbing"
  | "cycling"
  | "scenic_drive"
  | "viewpoint"
  | "photography_walk"
  | "cooking_class"
  | "wine_tasting"
  | "coffee_tour"
  | "spa"
  | "hot_spring"
  | "religious_site"
  | "historic_site"
  | "national_park"
  | "wildlife"
  | "theme_park"
  | "zoo"
  | "aquarium"
  | "free_time"
  | "volunteering"
  | "workshop"
  | "other";

export interface ActivityStepInterval extends BaseStepInterval {
  intervalType: "activity";
  activityType: ActivityType;
  /** Optional slot-specific place — id in {@link Trip#destinations}. */
  destinationId?: string;
}

export type WarningSeverity = "info" | "warning" | "critical";

export interface TripWarning {
  id: string;
  severity: WarningSeverity;
  title: string;
  description: string;
  relatedStepId?: string;
}

/** Ordered within the trip (`steps` array order is not always enough for UI). */
export interface BaseStep {
  id: string;
  order: number;
  title: string;
  startTime: ISODateString;
  endTime?: ISODateString;
  notes?: string[];
  warnings?: TripWarning[];
}

export interface StayStep extends BaseStep {
  stepType: "stay";
  /** Primary stay place — id in {@link Trip#destinations}. */
  targetDestinationId: string;
  stepIntervals: StayStepInterval[];
  manualEndStayTime?: ISODateString;
}

export interface TransitStep extends BaseStep {
  stepType: "transit";
  /** Step-level placeholder row — id in {@link Trip#destinations}. */
  targetDestinationId: string;
  fromStayId: string;
  toStayId: string;
  stepIntervals: TransitStepInterval[];
  totalManualPrice?: Money;
}

export interface ActivityStep extends BaseStep {
  stepType: "activity";
  destinationId: string;
  targetDestinationId: string;
  stepIntervals: ActivityStepInterval[];
}

export type TripStep = StayStep | TransitStep | ActivityStep;

export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";

export interface TripTask {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate?: ISODateString;
  relatedStepId?: string;
  notes?: string;
}

export interface TripDocument {
  id: string;
  title: string;
  type: "passport" | "visa" | "insurance" | "license" | "medical" | "other";
  travelerId?: string;
  url?: string;
  /** Firebase Storage object path; set when `url` is from Storage so the file can be deleted. */
  storagePath?: string;
  expirationDate?: ISODateString;
  notes?: string;
}

export interface Trip {
  id: string;
  title: string;
  description?: string;
  currency: CurrencyCode;
  /** People on the trip who may edit (see {@link TravelerRole}). */
  travelers: Traveler[];
  /**
   * Read-only access list (names/emails for display and future ACL).
   * Omitted or empty when there are no viewers.
   */
  viewers?: TripViewer[];
  startDate: ISODateString;
  endDate: ISODateString;
  /**
   * Canonical list of places for this trip (Firebase document field). Steps reference rows by id.
   */
  destinations: Destination[];
  steps: TripStep[];
  budget?: TripBudget;
  tasks?: TripTask[];
  documents?: TripDocument[];
  warnings?: TripWarning[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
