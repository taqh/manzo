export const DEFAULT_TIME_ZONE = "UTC";

export type InboxPeriod = "today" | "yesterday";

export type TimeRange = {
  startAt: number;
  endAt: number;
};

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function partsAt(timestamp: number, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));

  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function offsetAt(timestamp: number, timeZone: string): number {
  const parts = partsAt(timestamp, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return representedAsUtc - Math.floor(timestamp / 1_000) * 1_000;
}

function zonedMidnightUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): number {
  const wallClockMidnight = Date.UTC(year, month - 1, day);
  let candidate = wallClockMidnight - offsetAt(wallClockMidnight, timeZone);

  // Re-evaluate at the candidate so this also works for zones with DST.
  candidate = wallClockMidnight - offsetAt(candidate, timeZone);
  return candidate;
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  amount: number,
): Pick<DateParts, "year" | "month" | "day"> {
  const shifted = new Date(Date.UTC(year, month - 1, day + amount));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function inboxPeriodRange(
  period: InboxPeriod,
  now = Date.now(),
  timeZone = DEFAULT_TIME_ZONE,
): TimeRange {
  const localNow = partsAt(now, timeZone);
  const startDate = addCalendarDays(
    localNow.year,
    localNow.month,
    localNow.day,
    period === "yesterday" ? -1 : 0,
  );
  const endDate = addCalendarDays(
    startDate.year,
    startDate.month,
    startDate.day,
    1,
  );

  return {
    startAt: zonedMidnightUtc(
      startDate.year,
      startDate.month,
      startDate.day,
      timeZone,
    ),
    endAt: zonedMidnightUtc(
      endDate.year,
      endDate.month,
      endDate.day,
      timeZone,
    ),
  };
}

export function formatLocalTimestamp(
  timestamp: number,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "full",
    timeStyle: "long",
  }).format(new Date(timestamp));
}
