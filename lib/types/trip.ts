export type StepStatus = "todo" | "active" | "done";

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
  smartTimeline: boolean;
  autoCurrentByDate: boolean;
  createdAt: string;
  updatedAt: string;
  steps: TripStep[];
}
