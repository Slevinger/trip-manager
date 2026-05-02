# planner-next

Next.js app using the **canonical trip model** (ISO datetimes, stay / transit / activity steps with `stepIntervals`, travelers, tasks, documents, budget).

## Where things live

| What | Where |
|------|--------|
| **Trip list & “New trip”** | `/` — `app/page.tsx` |
| **View trip (read-only)** | `/trip/[id]` — tab **View** |
| **Edit trip** | `/trip/[id]` — tab **Manage** (full trip JSON, **Save** → browser storage) |

## Storage

- **With `NEXT_PUBLIC_FIREBASE_*` set** (copy from the root app’s `.env.local` into `planner-next/.env.local`): trips live in Firestore under the **`canonicalTrips`** collection (one document per trip; `ownerUid` + `ownerEmailLower` are stored for rules). Sign in with **Google** on the home page.
- **Without Firebase env**: trips fall back to **`localStorage`** (`planner-next:v1`). First visit seeds one sample trip.

After changing `firestore.rules` in the repo root, deploy rules so `canonicalTrips` is allowed, e.g.:

`firebase deploy --only firestore:rules`

```bash
cd planner-next
npm install
npm run dev
```

Port **3001** (see `package.json`) so it can run beside the legacy root app on **3000**.
