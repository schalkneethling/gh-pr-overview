const SOUND_KEY = "pr-quest:sound";
const OWNER_KEY = "pr-quest:owner";

// Storage can throw (private mode, blocked site data); a preference is a
// convenience, so failures fall back to the default silently.

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Ignore: the choice still works for this visit.
  }
}

export function readSoundPreference(): boolean {
  return read(SOUND_KEY) === "on";
}

export function writeSoundPreference(enabled: boolean): void {
  write(SOUND_KEY, enabled ? "on" : "off");
}

/** The owner picked last time, or null for the server's default. */
export function readOwnerPreference(): string | null {
  return read(OWNER_KEY);
}

export function writeOwnerPreference(owner: string | null): void {
  write(OWNER_KEY, owner);
}
