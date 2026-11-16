# Memory prompts, reminders and the phone app

Approved by Marc on 2026-11-14. Built in three parts, one pull request or more each.

## Why

The person capturing themselves will not sit down at a PC and think of something to say. Echo has
to come to them, at a time they chose, with one small question about one moment in their life. For
someone whose memory is starting to go, that has to be gentle: no lists, no streaks, no guilt.

## How it fits together

```
 PHONE (Echo app)                                 HOME PC (Echo desktop)
 Reminder at a time they chose ─┐
                                ├─> record ─> encrypt ─> waits on phone
 "Share a memory" button ───────┘  (prompt)  on phone        │
                                                             │ same home Wi-Fi?
                                      finds the paired PC ───┴──> sends ──> archive
                                      PC confirms it is saved <────────────┘
                                      phone deletes its copy
```

The PC stays the only place the archive lives. The phone is a microphone and a reminder.

## Part 1: the memory prompt deck (built, #40)

- About 70 questions about single moments, in stages of a life: childhood, growing up, getting
  going, love, family, friends, times and places, hard times, what I have learned. Marc's own
  examples are all in it: first day at school, riding a bike, learning to drive, first night out,
  a love lost, how you met someone.
- Some questions name someone from the People list, chosen by the relationship the person typed:
  "How did you meet Julie?" for a wife or husband, "What do you remember about the day Sam was
  born?" for a son or daughter. A grandchild is never taken for a child. Questions nobody fits are
  left out.
- Tell a story opens with a suggested question, taking one stage at a time in turn so a run of
  sessions moves through a whole life. A question already answered in a story is not suggested
  again. "Ask me something else" moves the suggestion on. The full list is still there to choose
  from, and the person can ignore all of it.
- Code: `src/shared/story-prompts.ts`. The 18 old prompts in `src/shared/stories.ts` are replaced.

## Part 2: reminders and "I don't remember"

Built in #41: the schedule, "I don't remember" (with an Undo for a press made by
mistake), the one-nudge rule, and the Memory times panel on the Stories screen. The phone reads
the schedule once part 3 pairs it. The one-question-then-follow-ups session and children's own
questions come with the phone app and family access. Code: `src/shared/memory-times.ts` (the
rules), `src/core/memory-times.ts` (kept sealed as `memory-times.sealed`), and
`src/renderer/screens/MemoryTimes.tsx`. Both the schedule and the put-away questions are in the
export as `memory-times.json`.


- The person, or a son or daughter sitting with them, picks days of the week, a time, and how long
  (15, 30 or 60 minutes). Kept in the archive so the phone can read it once paired.
- A session is one question, the person talks, then two or three follow-up questions from the
  interviewer that already exists. Then it is done.
- **"I don't remember"** is a proper answer. It retires that question for good, kindly, with no
  follow-up.
- A missed session gets one gentle nudge the next day, then nothing until the next one. No streaks,
  no counts of what was missed. Anything done that day (a story, or "I don't remember") counts as
  having come. The nudge is owed from the usual time on the following day, and not at all when
  that day is itself a memory day, because its own reminder does the job.
- Later, once family access (sub-project 4) exists: children can add their own questions, which
  come up in the parent's next session.

## Part 3: the phone app and the desktop inbox

- **Pairing:** once, by scanning a QR code shown on the PC. It swaps keys so the phone encrypts
  everything for that PC only. The phone never holds the archive's key.
- **On the phone:** reminder notifications at the chosen times; one big "Share a memory" button;
  today's question; the next reminder; "3 memories waiting to go home". Nothing else.
- **Recording** is encrypted on the phone the moment it stops, so a lost phone gives nothing away.
- **Sync** happens on the home network only. The phone finds the PC the way it finds a printer,
  with no cloud and no account. If the PC is off, recordings wait. The phone deletes its copy only
  after the PC confirms it is saved.
- **The desktop inbox** listens on the home network only, refuses anything not from a paired phone,
  and files each recording as a story ready to be written down.
- **Built with** Capacitor, one codebase for iPhone and Android.

### Part 3a: the link and the desktop inbox (built, #42)

No screen yet: 3b adds the pairing screen with the QR code, and 3c the phone app.

```
 PHONE                                   PC (archive open)
 scan QR  ── echo-pair:{host, port, PC key, one-time token}
 POST /pair  {phone key, sealed{token, name}} ──> token checks? ──> phone paired
             <── {paired, receipt}                (code then stops working)
 POST /recordings  sealed envelope ──> paired phone? opens? consent? ──> story
             <── {saved: id, receipt}   phone deletes its copy only if the receipt checks
```

- **Keys:** each device has an X25519 key pair. The PC's private key is sealed inside the archive,
  so it can be used only while the archive is open. The phone never holds the archive's key.
- **Sealing:** HKDF-SHA256 on the shared secret, a fresh random salt per message, then AES-256-GCM.
  Envelope: version (1 byte), phone public key (32), salt (32), nonce (12), sealed body. The body
  is a 4-byte header length, the header as JSON (`id`, `recordedAt`, `prompt`, `seconds`,
  `mimeType`), then the recording. These are standard primitives, so the phone app can use
  WebCrypto or a vetted library.
- **Receipts:** HMAC-SHA256 of `saved:<id>` with a key only the two devices can work out, so
  nobody else on the network can make the phone delete a recording that was not saved.
- **Pairing code:** valid for 10 minutes, once, and dropped after 5 wrong tries. The token travels
  sealed, never in the clear.
- **Listening:** port 47821, only while the archive is open and a phone is paired or a pairing code
  is showing. Requests from outside home-network addresses are refused. A pair request may be
  16 KB, a recording 200 MB. A resend of a saved recording gets its receipt again and is not saved
  twice. Without consent the PC answers 422 and the phone keeps the recording.
- **Finding the PC:** for now the QR code carries the PC's home-network address. Finding it again
  after the address changes (mDNS, "like a printer") comes with the phone app.
- **First run:** Windows asks once whether Echo may use private networks. Say yes for home Wi-Fi.

### Part 3b: the pairing screen (built, #43)

A "Your phone" panel on the Stories screen, under Memory times.

- **Pair a phone** shows the pairing code as a QR code, drawn by the PC with the
  `qrcode` library (Marc's call, 2026-11-14) and handed to the screen as an
  image, so the screen itself draws nothing it was not given.
- While the code shows, the screen looks for a newly paired phone every two
  seconds, then says which phone paired. When the ten minutes run out, or the
  person leaves the screen, the code is taken down and the PC stops listening
  unless a phone is already paired.
- Paired phones are listed with the day they paired, and each can be unpaired
  after a warning that anything still waiting on it can no longer arrive.
- The inbox now hangs up on a recording declared too big, rather than letting
  the phone upload the rest for nothing (from the review of #42).

### Part 3c: the phone app, first TestFlight build (built in this pull request)

The `phone/` folder: a Capacitor 8 iPhone app (React, bundled, never loaded
from a server). Under PropXchain Ltd's Apple team with the app ID
`io.github.madhatt4.echo` (Marc, 2026-11-15).

- **Pair:** scan the QR code with the camera (read in the app with `jsqr`),
  name the phone, and pair. The phone believes it is paired only on a receipt
  only the PC could make.
- **Record:** a question from the same deck as the desktop (no names, since
  the phone does not hold the People list), "Ask me something else", or "Just
  talk about anything". Listen back, then Keep it or Throw it away.
- **Sealed at once:** a kept recording is sealed for the PC before it is
  written to the phone, so only sealed bytes ever sit on the phone.
- **Send:** on opening the app, on coming back to it, after each recording,
  and on "Try sending now". Each one is deleted from the phone only on a
  receipt that checks out. Locked PC, PC not reachable and withdrawn consent
  each leave the recording waiting, with a plain line saying why.
- **Crypto:** the audited noble libraries (`@noble/curves`, `@noble/hashes`,
  `@noble/ciphers`), so it works on every iPhone from iOS 15. The phone's
  side is tested against the real desktop code in `phone/tests/link.test.ts`,
  which also runs in Checks.
- **Network:** native HTTP to the PC's plain `http://` home address, allowed
  by `NSAllowsLocalNetworking`. iOS asks once for local network access.
- **TestFlight:** `.github/workflows/ios-testflight.yml`, run by hand, with
  Apple cloud signing as in the PropXchain app.

Not yet: reminders on the phone at the memory times (the phone needs the
schedule from the PC first), finding the PC again if its address changes (re-pair
for now), keeping the phone's key in the Keychain rather than app storage, and
an Echo app icon.

## Not in these parts

- A wearable recorder. Phone first. If one comes later it keeps only the wearer's own voice.
- Reminders on the PC. The phone does that job.
