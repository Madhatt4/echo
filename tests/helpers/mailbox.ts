// Builds mailbox (mbox) files for tests.

export interface TestEmail {
  from: string;
  to?: string;
  subject?: string;
  date?: string;
  labels?: string;
  /** Extra header lines, each "Name: value". */
  headers?: string[];
  body: string;
}

let count = 0;

export function emailText(email: TestEmail): string {
  count += 1;
  const lines = [
    `From ${count}@test Sat Dec 13 09:00:00 +0000 2025`,
    ...(email.labels !== undefined ? [`X-Gmail-Labels: ${email.labels}`] : []),
    `From: ${email.from}`,
    ...(email.to !== undefined ? [`To: ${email.to}`] : []),
    `Subject: ${email.subject ?? 'Hello'}`,
    `Date: ${email.date ?? 'Sat, 13 Dec 2025 09:00:00 +0000'}`,
    ...(email.headers ?? [`Message-ID: <${count}@test>`]),
    ...(email.headers?.some((line) => /^content-type:/i.test(line)) ? [] : ['Content-Type: text/plain; charset="UTF-8"']),
    '',
    email.body,
    '',
  ];
  return lines.join('\r\n');
}

export function mailbox(emails: readonly TestEmail[]): Buffer {
  return Buffer.from(emails.map(emailText).join('\r\n'), 'latin1');
}
