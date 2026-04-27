export type StepStatus = "todo" | "active" | "done";

export interface AttachmentFile {
  id: string;
  name: string;
  url: string;
  path: string;
  size: number;
  contentType: string;
  uploadedAt: string;
}

export interface ArrivalOption {
  id: string;
  title: string;
  details: string;
  /** Computed from start/end (stored for prompts / export). */
  duration: string;
  cost: string;
  /** Option window start `dd-mm-yyyy`. */
  startDate: string;
  /** `HH:mm` or empty. */
  startTime: string;
  /** Option window end `dd-mm-yyyy`. */
  endDate: string;
  /** `HH:mm` or empty. */
  endTime: string;
}

export interface TransportOption {
  id: string;
  title: string;
  from: string;
  to: string;
  details: string;
  duration: string;
  cost: string;
}

export interface Hotel {
  id: string;
  name: string;
  /** Calendar day `dd-mm-yyyy`. */
  checkinDate: string;
  /** Clock time `HH:mm` (empty = no time). */
  checkinTime: string;
  checkoutDate: string;
  checkoutTime: string;
  bookingUrl: string;
  cost: number;
  notes: string;
}

export interface TripStepBase {
  id: string;
  order: number;
  type: "stay" | "transit";
  title: string;
  location: string;
  status: StepStatus;
  /** `dd-mm-yyyy` */
  startDate: string;
  /** `HH:mm` or empty */
  startTime: string;
  endDate: string;
  endTime: string;
  endDateOpen: boolean;
  nights: number;
  duration: string;
  arrivalSummary: string;
  arrivalOptions: ArrivalOption[];
  transportCost: number;
  foodCost: number;
  activitiesCost: number;
  otherCost: number;
  notes: string;
  attachments: AttachmentFile[];
  coordinates?: {
    lat: number;
    lng: number;
  };
  /** Optional map/diagram coordinates (from diagram JSON `x` / `y`). */
  mapX?: number;
  mapY?: number;
}

export interface StayStep extends TripStepBase {
  type: "stay";
  hotels: Hotel[];
}

export interface TransitStep extends TripStepBase {
  type: "transit";
  transports: TransportOption[];
  /** Stay step id this transit leaves from (same trip). */
  fromStayStepId?: string;
  /** Stay step id this transit arrives at (same trip). */
  toStayStepId?: string;
  /**
   * When false/undefined, `endDate`/`endTime` follow the last arrival option’s end
   * (when there is at least one arrival with a valid end date). Set true when the user edits step end manually.
   */
  transitEndManual?: boolean;
}

export type TripStep = StayStep | TransitStep;

export interface Trip {
  id: string;
  title: string;
  /** Trip first day `dd-mm-yyyy`. */
  tripStartDate: string;
  /** `HH:mm` or empty */
  tripStartTime: string;
  /** Planned budget in the app display currency. 0 means unset. */
  budget: number;
  managePassword: string;
  ownerUid: string;
  ownerEmail: string;
  ownerEmailLower: string;
  accessMode: "invited_only";
  tripAttachments: AttachmentFile[];
  smartTimeline: boolean;
  autoCurrentByDate: boolean;
  createdAt: string;
  updatedAt: string;
  steps: TripStep[];
}
