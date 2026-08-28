// Builds a one-event iCalendar (.ics) file. The same UID with a higher SEQUENCE
// updates the event in calendar apps; METHOD:CANCEL removes it.

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function text(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Lines longer than 75 octets must be folded (RFC 5545 §3.1).
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

export function buildIcs(event: {
  uid: string;
  sequence: number;
  start: Date;
  durationMinutes: number;
  summary: string;
  description?: string;
  location?: string | null;
  organizerEmail?: string;
  canceled?: boolean;
}): string {
  const end = new Date(event.start.getTime() + event.durationMinutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ClearSheet//Meetings//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${event.canceled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${text(event.summary)}`,
    ...(event.description ? [`DESCRIPTION:${text(event.description)}`] : []),
    ...(event.location ? [`LOCATION:${text(event.location)}`, `URL:${event.location}`] : []),
    ...(event.organizerEmail ? [`ORGANIZER:mailto:${event.organizerEmail}`] : []),
    `STATUS:${event.canceled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
