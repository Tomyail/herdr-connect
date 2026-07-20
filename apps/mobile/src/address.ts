/**
 * Address selection utilities shared across the networking and pairing layers.
 *
 * These are pure functions with no React Native dependencies so they can be
 * imported by test files without pulling in the RN bundle.
 */

export function isIPv4(address: string): boolean {
  const parts = address.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

/**
 * Select the best reachable address from a list of candidates.
 *
 * Prefers IPv4 (most likely reachable on a home LAN), falling back to the
 * first entry when no IPv4 address is among the candidates.
 */
export function preferredAddress(addresses: readonly string[]): string | undefined {
  return addresses.find(isIPv4) ?? addresses[0];
}
