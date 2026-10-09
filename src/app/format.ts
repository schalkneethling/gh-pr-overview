const RELATIVE_TIME_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

const relativeTimeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 days ago", "yesterday", "now" — the largest unit that fits wins. */
export function formatRelativeTime(isoDate: string, now: number): string {
  const elapsed = Date.parse(isoDate) - now;

  for (const [unit, size] of RELATIVE_TIME_UNITS) {
    if (Math.abs(elapsed) >= size) {
      return relativeTimeFormat.format(Math.round(elapsed / size), unit);
    }
  }

  return relativeTimeFormat.format(0, "second");
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** GitHub avatar URL at a given pixel size (the `s` parameter). */
export function avatarAtSize(avatarUrl: string, size: number): string {
  const url = new URL(avatarUrl);
  url.searchParams.set("s", String(size));

  return url.href;
}
