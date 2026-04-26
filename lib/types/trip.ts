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
  checkin: string;
  checkout: string;
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
  startDate: string;
  endDate: string;
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
  tripStart: string;
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
