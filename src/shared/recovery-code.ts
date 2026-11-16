// The recovery code printed on the recovery kit. It is long enough that it
// cannot be guessed (120 bits), and uses an alphabet with no look-alike
// characters so it survives being read off paper years later.

export const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_GROUPS = 6;
export const RECOVERY_GROUP_LENGTH = 4;
const RECOVERY_LENGTH = RECOVERY_GROUPS * RECOVERY_GROUP_LENGTH;

/** Tidies up what a person typed: case, spacing, dashes and look-alike letters. */
function tidy(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** Tidies one typed group. Returns null if it is not a valid group. */
export function normaliseGroup(input: string): string | null {
  const group = tidy(input);
  if (group.length !== RECOVERY_GROUP_LENGTH) return null;
  return [...group].every((c) => RECOVERY_ALPHABET.includes(c)) ? group : null;
}

/** Tidies a whole typed code. Returns null if it is not a complete, valid code. */
export function normaliseRecoveryCode(input: string): string | null {
  const code = tidy(input);
  if (code.length !== RECOVERY_LENGTH) return null;
  return [...code].every((c) => RECOVERY_ALPHABET.includes(c)) ? code : null;
}

/** Splits a normalised code into its printed groups. */
export function recoveryGroups(code: string): string[] {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += RECOVERY_GROUP_LENGTH) groups.push(code.slice(i, i + RECOVERY_GROUP_LENGTH));
  return groups;
}

/** The code as printed: ABCD-EFGH-... */
export function formatRecoveryCode(code: string): string {
  return recoveryGroups(code).join('-');
}
