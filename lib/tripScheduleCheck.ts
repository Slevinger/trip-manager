import type { Trip, TripStep } from "@/lib/types/trip";

// ---------------------------------------------------------------------------
// Command detection
// ---------------------------------------------------------------------------

const SCHEDULE_CHECK_PATTERNS: RegExp[] = [
  // English
  /\bcheck\s+(my\s+)?schedule\b/i,
  /\baudit\s+(my\s+)?schedule\b/i,
  /\breview\s+(my\s+)?(schedule|itinerary|timeline)\b/i,
  /\bfix\s+(my\s+)?(schedule|times?|itinerary)\b/i,
  /\bvalidate\s+(my\s+)?(schedule|itinerary)\b/i,
  // Hebrew
  /בדוק\s+את\s+(ה)?מסלול/i,
  /בדיקת\s+מסלול/i,
  /תקן\s+את\s+(ה)?לוח\s+הזמנים/i,
  /סדר\s+את\s+(ה)?לוח\s+הזמנים/i,
  // Russian
  /проверь\s+(моё?\s+)?расписание/i,
  /исправь\s+(моё?\s+)?расписание/i,
  /аудит\s+расписания/i,
];

export function isScheduleCheckCommand(text: string): boolean {
  const t = text.trim();
  return SCHEDULE_CHECK_PATTERNS.some((re) => re.test(t));
}

// ---------------------------------------------------------------------------
// System prompt appendix
// ---------------------------------------------------------------------------

export const SCHEDULE_CHECK_APPENDIX = `

### Schedule Audit Mode
The user wants you to audit and correct the trip schedule. Work through ALL \`trip.steps\` systematically:

1. **Chronological order** — Are steps sorted by \`startTime\`? Flag out-of-order steps.
2. **Overlapping windows** — Do any steps' \`startTime\`/\`endTime\` intervals collide? Resolve by adjusting the later step's start time.
3. **Missing times** — Steps with blank or identical \`startTime\`/\`endTime\`? Estimate realistic times from trip context and neighboring steps.
4. **Unrealistic durations** — Transit steps < 30 min or stays < 1 night? Flag them.
5. **Dead time / huge gaps** — Gaps > 8 hours between consecutive steps with no transit step? Flag as potential missing step.

**Reply format (required):**
- Open with a short summary (e.g. "Found 3 issues — fixed 2, flagged 1.").
- One bullet per issue: what was wrong → what was done.
- If the schedule is clean: say "Schedule looks good — no conflicts found."
- When ANY step's times were corrected, append exactly one fenced \`trip-schedule-fix\` block:

\`\`\`trip-schedule-fix
{ "patches": [{ "stepId": "STEP_ID", "startTime": "ISO_DATE", "endTime": "ISO_DATE" }], "summary": "short human summary of what changed" }
\`\`\`

- End with \`##specific##\`.
- Do NOT emit a \`trip-suggestions\` fence in this mode.
`;

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export interface SchedulePatch {
  stepId: string;
  startTime: string;
  endTime: string;
}

export interface ScheduleFixResult {
  cleanedReply: string;
  patches: SchedulePatch[];
  summary: string;
}

const SCHEDULE_FIX_FENCE_RE = /```trip-schedule-fix\s*\n([\s\S]*?)\n```/i;

export function extractScheduleFixFromReply(text: string): ScheduleFixResult {
  const match = SCHEDULE_FIX_FENCE_RE.exec(text);
  if (!match) return { cleanedReply: text, patches: [], summary: "" };

  const cleanedReply = text.replace(match[0], "").replace(/\n{3,}/g, "\n\n").trim();
  try {
    const data = JSON.parse(match[1]) as {
      patches?: unknown[];
      summary?: string;
    };
    const patches: SchedulePatch[] = [];
    for (const p of Array.isArray(data.patches) ? data.patches : []) {
      if (
        p != null &&
        typeof p === "object" &&
        "stepId" in p &&
        "startTime" in p &&
        "endTime" in p &&
        typeof (p as Record<string, unknown>).stepId === "string" &&
        typeof (p as Record<string, unknown>).startTime === "string" &&
        typeof (p as Record<string, unknown>).endTime === "string"
      ) {
        patches.push({
          stepId: (p as { stepId: string }).stepId,
          startTime: (p as { startTime: string }).startTime,
          endTime: (p as { endTime: string }).endTime,
        });
      }
    }
    return {
      cleanedReply,
      patches,
      summary: typeof data.summary === "string" ? data.summary : "",
    };
  } catch {
    return { cleanedReply, patches: [], summary: "" };
  }
}

// ---------------------------------------------------------------------------
// Patch application
// ---------------------------------------------------------------------------

export function applySchedulePatches(trip: Trip, patches: SchedulePatch[]): Trip {
  if (!patches.length) return trip;
  const patchMap = new Map(patches.map((p) => [p.stepId, p]));
  const steps: TripStep[] = trip.steps.map((step) => {
    const patch = patchMap.get(step.id);
    if (!patch) return step;
    return { ...step, startTime: patch.startTime, endTime: patch.endTime };
  });
  return { ...trip, steps, updatedAt: new Date().toISOString() };
}
