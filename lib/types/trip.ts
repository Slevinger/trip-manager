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
  /**
   * Optional geographic center of the stay area — id in {@link Trip#destinations}.
   * With saved coordinates, the itinerary map can draw a circle: radius = farthest stay-interval
   * pin from this center (see `collectStayAreaCircles` in trip map geometry).
   */
  areaCenterDestinationId?: string;
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
  /**
   * Optional anchor stay this activity belongs with (e.g. day trips while based there).
   * Must reference {@link StayStep#id} from the same trip when set.
   */
  hostStayStepId?: string;
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

export interface TripLiveLocation {
  name: string;
  lat: number;
  lon: number;
  updatedAt: ISODateString;
}

/**
 * Pending suggestion for the trip — surfaced in the floating notifications dock.
 *
 * A recommendation is a *bundle of options* (each carrying a full step-interval
 * payload of the same `kind`). The user picks one option to approve: either it
 * becomes a **new** step, or — when {@link BaseRecommendationOption#targetStepId}
 * is set — the interval is **merged** into that existing step’s `stepIntervals`
 * (same `stepType` as `kind`). The whole recommendation stays in the queue until
 * the user approves an option or deletes the recommendation.
 *
 * Recommendations live alongside `steps` rather than inside one so the queue
 * is order-independent and can be authored by the assistant or other tooling.
 */
export type TripRecommendationKind = "stay" | "transit" | "activity";

interface BaseRecommendationOption {
  id: string;
  /** Short label shown in the option picker (falls back to `interval.title`). */
  label?: string;
  /** Per-option rationale shown when this option is selected. */
  note?: string;
  /**
   * Optional registry rows to merge into {@link Trip#destinations} when this
   * option is approved. Use when the option references destinations that may
   * not yet exist on the trip (ids should match the interval's references).
   */
  destinations?: Destination[];
  /**
   * When set, approving merges `interval` into this step’s `stepIntervals` instead
   * of creating a new step. Must match some {@link TripStep#id} whose `stepType`
   * equals this option’s recommendation `kind` (`stay` / `transit` / `activity`).
   */
  targetStepId?: string;
  /** Direct booking / info URL (hotel page, transit booking, attraction site…). */
  url?: string;
  /** Photo or thumbnail URL to show alongside the option. */
  imageUrl?: string;
  /** Human-readable price note, e.g. "€120/night", "~$45 pp", "Free entry". */
  priceNote?: string;
}

export interface StayRecommendationOption extends BaseRecommendationOption {
  interval: StayStepInterval;
}

export interface TransitRecommendationOption extends BaseRecommendationOption {
  interval: TransitStepInterval;
}

export interface ActivityRecommendationOption extends BaseRecommendationOption {
  interval: ActivityStepInterval;
  /** When the activity is tied to an existing stay segment, set to that {@link StayStep#id}. */
  hostStayStepId?: string;
}

interface BaseTripRecommendation {
  id: string;
  /** ISO time the recommendation was added to the queue. */
  createdAt: ISODateString;
  /** Free-form provenance ("assistant", "manual", a tool name…). Used in the dock subtitle. */
  source?: string;
  /** Headline shown on the notification card. */
  title?: string;
  /** Why-this-recommendation note shown above the option picker. */
  note?: string;
  /**
   * Set to `true` once the user explicitly skipped this card in the dock without
   * approving or deleting it. Skipped items stay in the queue (moved to the end)
   * but no longer trigger the "new" indicator on the bell or the card.
   */
  seen?: boolean;
  /**
   * When set, only these email addresses may see this recommendation in the UI.
   * Stamped by the assistant when the originating chat turn was `@private`.
   * Stripped when the recommendation is approved into the itinerary (it becomes public).
   */
  visibleTo?: string[];
}

export interface StayRecommendation extends BaseTripRecommendation {
  kind: "stay";
  options: StayRecommendationOption[];
}

export interface TransitRecommendation extends BaseTripRecommendation {
  kind: "transit";
  options: TransitRecommendationOption[];
}

export interface ActivityRecommendation extends BaseTripRecommendation {
  kind: "activity";
  options: ActivityRecommendationOption[];
}

export type TripRecommendation =
  | StayRecommendation
  | TransitRecommendation
  | ActivityRecommendation;

export type TripRecommendationOption =
  | StayRecommendationOption
  | TransitRecommendationOption
  | ActivityRecommendationOption;

export type PackingCategory =
  | "documents"
  | "clothes"
  | "toiletries"
  | "tech"
  | "health"
  | "gear"
  | "misc";

export interface PackingItem {
  id: string;
  name: string;
  category: PackingCategory;
  quantity?: number;
  packed: boolean;
  /** Owner; missing means shared / household item. */
  travelerId?: string;
  /** Marker so reset / template-merge knows what came from a template. */
  templateId?: string;
}

export interface PackingList {
  id: string;
  title: string;
  items: PackingItem[];
  /** Source template applied to this list (if any). */
  templateId?: string;
}

export type ExpenseCategory =
  | "hotels"
  | "transport"
  | "food"
  | "activities"
  | "shopping"
  | "insurance"
  | "other";

export interface ExpenseEntry {
  id: string;
  title: string;
  amount: Money;
  /** Traveler id of the person who paid. */
  paidByTravelerId: string;
  /** Traveler ids the cost is split across (equally). Empty = paid alone. */
  splitBetween: string[];
  category?: ExpenseCategory;
  date: ISODateString;
  /** Optional link back to an itinerary step. */
  relatedStepId?: string;
  notes?: string;
}

export type CommentTargetType = "trip" | "step" | "recommendation" | "destination";

export interface TripComment {
  id: string;
  /** Lowercased email of the author (matches travelers/viewers email). */
  authorId: string;
  authorName?: string;
  createdAt: ISODateString;
  body: string;
  targetType: CommentTargetType;
  targetId: string;
  resolved?: boolean;
  /** Threading: id of the parent comment when this is a reply. */
  parentId?: string;
  /** Lowercased emails of travelers who reacted thumbs-up (toggle). */
  reactions?: string[];
}

export interface RecommendationVote {
  recommendationId: string;
  optionId: string;
  /** Lowercased email of the voter. */
  travelerId: string;
  createdAt: ISODateString;
}

export interface WeatherDay {
  dateIso: string;
  tempMaxC: number;
  tempMinC: number;
  precipMm?: number;
  weatherCode: number;
}

export interface WeatherSnapshot {
  destinationId: string;
  updatedAt: ISODateString;
  daily: WeatherDay[];
}

/** Scenic hero background for trip overview; chosen from destinations (API + optional LLM query). */
export interface TripHeroCover {
  url: string;
  destinationLabel?: string;
  query?: string;
  photographerName?: string;
  photoPageUrl?: string;
  licenseNote?: string;
  updatedAt: ISODateString;
}

/** Server/API payload before `updatedAt` is set on save. */
export type TripHeroCoverPersistPayload = Omit<TripHeroCover, "updatedAt">;

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
  /**
   * Pending suggestions queued for review. Surfaced via the floating notifications dock;
   * each entry carries a full step interval that can be promoted into `steps` on approve.
   */
  recommendations?: TripRecommendation[];
  /**
   * Recommendation ids removed from the queue (dismiss / approve). Used so thread snapshots
   * do not resurrect deleted cards when syncing suggestions from the shared assistant thread.
   */
  removedRecommendationIds?: string[];
  /** Live device positions by participant key (typically lowercased email). */
  liveLocations?: Record<string, TripLiveLocation>;
  warnings?: TripWarning[];
  /** Per-trip packing lists (smart categories, optionally per traveler). */
  packingLists?: PackingList[];
  /** Per-expense ledger; rolls up into the Budget screen. */
  expenses?: ExpenseEntry[];
  /** Comments on the trip / steps / destinations / recommendations. */
  comments?: TripComment[];
  /** Per-option votes on recommendations (collaborative voting). */
  recommendationVotes?: RecommendationVote[];
  /** Cached weather snapshots per destination. */
  weatherCache?: WeatherSnapshot[];
  /** Auto-filled scenic photo for overview hero (destinations-based). */
  heroCover?: TripHeroCover;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
