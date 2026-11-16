// The consent statement the person reads aloud on camera before anything
// else can be captured. Wording approved by Marc (spec section 3, decision C).

/** Plain-English problems with the name. An empty list means it is fine. */
export function nameProblems(fullName: string): string[] {
  const name = fullName.trim();
  if (name.length < 2) return ['Type your full name, as you would sign it.'];
  if (name.length > 120) return ['That name is too long.'];
  return [];
}

/** The date as it is read aloud: 11 November 2026. */
export function spokenDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** The exact statement, with the person's own name and the date filled in. */
export function consentWording(fullName: string, date: Date): string {
  return [
    `I, ${fullName.trim()}, on ${spokenDate(date)}, am creating an AI echo of myself.`,
    'I consent to my face, my voice and my personality being used to create an AI version of me that my named family members can talk to after my death.',
    'I understand it will always be presented as an AI echo and never as me being alive.',
    'I can withdraw this consent at any time while I am alive.',
    'After my death, my nominated heir can pause or delete it.',
  ].join(' ');
}
