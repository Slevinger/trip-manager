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

export interface TripStep {
  id: string;
  order: number;
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
  transport: string;
  arrivalSummary: string;
  arrivalOptions: ArrivalOption[];
  hotels: Hotel[];
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
