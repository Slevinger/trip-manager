import { redirect } from "next/navigation";
import { randomUUID } from "crypto";

/** Same flow as before `/new`: assign a fresh trip id and open the editor. */
export default function NewTripFromListPage() {
  redirect(`/trip/${randomUUID()}`);
}
