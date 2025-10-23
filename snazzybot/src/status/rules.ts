export function isRestricted(groups?: string[]): boolean {
  return (
    !!groups?.some((group) => /security/i.test(group)) ||
    !!groups?.some((group) => /confidential/i.test(group))
  );
}
