import { redirect } from "next/navigation";

/** Legacy URL: same as `/trip/new` (new id then open `/trip/[id]`). */
export default function NewTripPage() {
  redirect("/trip/new");
}
