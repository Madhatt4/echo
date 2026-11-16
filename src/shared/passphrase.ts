// The rules a passphrase must meet. Used by the screen (to guide the person as
// they type) and by the app itself (which never trusts the screen).

export const MIN_PASSPHRASE_LENGTH = 12;

/** Plain-English problems with a new passphrase. An empty list means it is fine. */
export function passphraseProblems(passphrase: string, confirmation: string): string[] {
  const problems: string[] = [];
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    problems.push(`Use at least ${MIN_PASSPHRASE_LENGTH} characters. Four or more unrelated words works well.`);
  } else if (new Set(passphrase).size < 5) {
    problems.push('That is too easy to guess. Use more than a few different characters.');
  }
  if (passphrase !== passphrase.trim()) {
    problems.push('Remove the space at the start or end. It is easy to forget it is there.');
  }
  if (passphrase !== confirmation) {
    problems.push('The two passphrases do not match.');
  }
  return problems;
}
