import type { Trip } from "@/lib/types/trip";

const t0 = new Date().toISOString();

export const sampleTrip: Trip = {
  id: "sample-1",
  title: "Bangkok long weekend",
  description: "Canonical-model sample trip",
  currency: "THB",
  travelers: [
    { id: "tr-1", name: "Alex", email: "alex@example.com", role: "owner" },
    { id: "tr-2", name: "Sam", role: "editor" },
  ],
  viewers: [{ id: "vw-1", name: "Jordan", email: "jordan@example.com" }],
  startDate: "2026-06-01T14:00:00.000Z",
  endDate: "2026-06-05T11:00:00.000Z",
  destinations: [
    {
      id: "dest-bkk",
      title: "Bangkok",
      location: "Sukhumvit, Bangkok",
      description: "Bangkok, Thailand",
      coordinates: { lat: 13.7373, lon: 100.5607 },
    },
    {
      id: "dest-ko",
      title: "Koh Samet",
      location: "Na Dan pier area",
      description: "Rayong Province, Thailand",
      coordinates: { lat: 12.5657, lon: 101.4518 },
    },
    {
      id: "dest-snorkel",
      title: "East coast reef",
      location: "Koh Samet",
      description: "Koh Samet, Thailand",
    },
  ],
  budget: {
    totalBudget: { amount: 45000, currency: "THB" },
    categories: {
      hotels: { amount: 18000, currency: "THB" },
      transport: { amount: 12000, currency: "THB" },
      food: { amount: 8000, currency: "THB" },
      activities: { amount: 7000, currency: "THB" },
    },
  },
  tasks: [
    {
      id: "task-1",
      title: "Book airport van",
      status: "todo",
      dueDate: "2026-05-20T12:00:00.000Z",
    },
  ],
  documents: [],
  warnings: [],
  steps: [
    {
      id: "st-1",
      order: 0,
      stepType: "stay",
      title: "Sukhumvit base",
      startTime: "2026-06-01T15:00:00.000Z",
      endTime: "2026-06-04T11:00:00.000Z",
      targetDestinationId: "dest-bkk",
      stepIntervals: [
        {
          id: "int-1",
          intervalType: "stay",
          stayType: "hotel",
          title: "City hotel",
          startTime: "2026-06-01T15:00:00.000Z",
          endTime: "2026-06-04T11:00:00.000Z",
          checkInTime: "2026-06-01T15:00:00.000Z",
          checkOutTime: "2026-06-04T11:00:00.000Z",
          nights: 3,
          location: "Sukhumvit Soi 24",
          booking: {
            status: "reserved",
            bookingUrl: "https://example.com",
          },
        },
      ],
    },
    {
      id: "step-transit-1",
      order: 1,
      stepType: "transit",
      title: "To islands",
      startTime: "2026-06-04T12:30:00.000Z",
      endTime: "2026-06-04T16:00:00.000Z",
      fromStayId: "dest-bkk",
      toStayId: "dest-ko",
      targetDestinationId: "dest-ko",
      stepIntervals: [
        {
          id: "int-tr-1",
          intervalType: "transit",
          transitType: "speed_boat",
          title: "Van + ferry",
          startTime: "2026-06-04T12:30:00.000Z",
          endTime: "2026-06-04T16:00:00.000Z",
          fromDestinationId: "dest-bkk",
          toDestinationId: "dest-ko",
        },
      ],
    },
    {
      id: "ac-1",
      order: 2,
      stepType: "activity",
      title: "Snorkel trip",
      startTime: "2026-06-05T08:00:00.000Z",
      endTime: "2026-06-05T11:00:00.000Z",
      destinationId: "dest-snorkel",
      targetDestinationId: "dest-snorkel",
      stepIntervals: [
        {
          id: "int-ac-1",
          intervalType: "activity",
          activityType: "snorkeling",
          title: "Half-day boat",
          startTime: "2026-06-05T08:00:00.000Z",
          endTime: "2026-06-05T11:00:00.000Z",
          destinationId: "dest-snorkel",
        },
      ],
    },
  ],
  createdAt: t0,
  updatedAt: t0,
};
