# Echo — decisions log

Every decision Marc has made, newest round last. Decisions are Marc's; plumbing is Claude's.

## Fixed by Marc before round 1

- ~~v1 is for Marc and family only; structure for a product later, build nothing for it now~~ (replaced in round 4)
- Four sub-projects: 1 capture app, 2 persona engine, 3 voice and face, 4 family access
- Build order: 1 and 2 with plain text chat first, then 3, then 4
- Clone rules (non-negotiable): self-created with recorded consent; presented as an AI echo, never as alive;
  answers only from captured material and says so in character when it has nothing; named family only, no public link;
  encrypted at rest, exportable, heir can pause or delete; other people's private messages are never quoted back

## Decisions locked (round 1, 2026-11-10)

| # | Decision | Answer |
|---|----------|--------|
| 1 | Face capture | Selfies AND a guided 2-minute video |
| 2 | Transcription | On the PC (audio never leaves) |
| 3 | Account ownership | One dedicated Echo mailbox owns the API key and every vendor account |
| 4 | Avatar vendor | Not chosen now. Bake-off with Marc's own face at sub-project 3 |
| 5 | Repo | Private repo `echo` on GitHub account `Madhatt4` |

## Decisions locked (round 2, 2026-11-10)

| # | Decision | Answer |
|---|----------|--------|
| 1 | Message sources | ALL messaging services first (SMS/text, Messenger, WhatsApp and others), then email, then letters |
| 2 | Other people's words | Kept on the PC only as context; never uploaded, never quotable |
| 3 | Character interview | AI interviewer with follow-ups, working from a fixed spine of topics |
| 4 | Encryption key | Passphrase (recovery kit confirmed in round 3) |
| 5 | Occasion advice | Capture both kinds (say when asked, and release on the day) |

Requirement stated by Marc in round 2: talking to the echo must feel like a natural two-way conversation,
not playback of recorded answers.

## Decisions locked (round 3, 2026-11-10)

| # | Decision | Answer |
|---|----------|--------|
| 1 | Phone | iPhone (texts come from a local iPhone backup on the PC) |
| 2 | Recovery kit | Yes — printed recovery kit for the heir alongside the passphrase |
| 3 | How the echo speaks | As "I", with a short line at the start of each session saying it is an AI echo |
| 4 | Memory of family | Yes — remembers what each person tells it, kept separately per person |
| 5 | Privacy per person | Yes — material can be tagged for one person only; default is everyone |
| 6 | The judge | Marc plus one family member, blind, same 20 questions |

## Decisions locked (spec open points A-F, 2026-11-10)

| | Decision | Answer |
|---|----------|--------|
| A | Other people's words and the Claude API | Allowed in passing as context during analysis; never stored in the persona store, never quotable |
| B | Blind test pass bar | Real Marc picked at most 13 in 20; echo averages 4 out of 5 or better |
| C | Consent wording | Approved as drafted in the spec, section 3 |
| D | Other messaging services | Discord (data package holds Marc's own messages only) |
| E | Views on things Marc never spoke about | Yes, in Marc's voice; never presented as a memory |
| F | Backup location | External drive now; cloud storage at sub-project 4 |

## Recorded 2026-11-10 (voice)

| Topic | Answer |
|---|---|
| Decision E wording | Confirmed: views come out sounding like Marc ("Knowing me, I'd tell you to..."), not as a disclaimer |
| Cloud storage direction (sub-project 4) | ICP. Text archive, consent record and audit trail in a canister, prepaid with cycles. Bulky audio and video masters stay on the external drive and ordinary storage unless Marc says otherwise. Price checked 2026-11-10: about $5.47 per GiB per year on a 13-node subnet |

## Decisions locked (round 4 — scope change, 2026-11-10)

This round REPLACES the earlier line "v1 is for Marc and family only; structure for a product later,
build nothing for it now".

| # | Decision | Answer |
|---|----------|--------|
| 1 | Who the first build is for | Anyone can use it to create their own echo; Marc is the first user. Marc offers the tool, not hosting |
| 2 | AI behind it | Claude first, through the user's own API key; built so other providers can be added. Checked 2026-11-10: Anthropic does not allow chat subscriptions to be used in third-party apps, so an API key is required |
| 3 | Storage offered | Local first; ICP added at sub-project 4, paid by the user |

Not built: selling, payments, website, accounts, hosting, support desk.
Known limit recorded in the spec: the app cannot prove who is in front of the camera at the consent step.
Marc also joked about asking whether Anthropic would back it; no action taken.

## Plumbing chosen by Claude

- Desktop app: Electron + TypeScript + SQLite (reliable webcam and microphone capture)
- Persona engine: Node service, runs on the PC first, deploys unchanged to AWS Lightsail London later
- Design principle: Echo keeps master recordings and the consent video in its own encrypted archive, so no clone depends on one vendor

## Plumbing chosen at build step 2 (2026-11-10)

- One random master key encrypts the archive. It is stored only wrapped by a key worked out from the
  passphrase (scrypt, about half a second per guess), so the recovery kit at step 3 can wrap the same
  master key a second time. Either opens the archive; changing one never re-encrypts the archive.
- The master key lives only in the app's memory while unlocked. The screen never receives it.
- The audit trail is an encrypted, append-only file inside the archive. Each entry carries a fingerprint
  of the one before, so removing, reordering or editing an entry is detected.
- Failed unlock attempts cannot be encrypted while locked, so they are counted in the open and written
  into the audit trail at the next successful unlock. Each wrong guess slows the next, up to 8 seconds.
- The archive folder is always named `Echo Archive`, inside a folder the person chooses (default: Documents).
- How structured data is stored was settled in two parts: see "Plumbing chosen at build step 6".

## Plumbing chosen at build step 3 (2026-11-11)

- The recovery code is 24 characters (120 bits) in six groups of four, from an alphabet with no I, L, O or U.
  Typing is forgiven for case, spaces, dashes and look-alike letters.
- A new code opens nothing until the person types back two groups Echo asks for, with the code hidden.
  Only then is it stored (wrapped, like the passphrase). An unproven code is forgotten on lock or close.
- Nothing else in Echo can be reached until the kit is proven. An archive made before step 3 is asked
  for its kit at the next unlock.
- Opening with the recovery kit forces a new passphrase before anything else. The old passphrase stops
  working; the kit keeps working.
- The kit can be printed or saved as a PDF (for people with no printer). Echo cannot verify that paper
  came out of a printer; the typed-back groups are the proof.
- Not built yet: making a replacement kit on demand, and changing the passphrase on demand. The vault
  already supports both; the buttons belong with the Setup tile at step 4.

## Plumbing chosen at build step 4 (2026-11-11)

- The AI key is tested by asking Anthropic to list models (`GET /v1/models`), which costs nothing.
  Checked 2026-11-11 from Marc's PC: a made-up key gets HTTP 401 "authentication_error".
  The test cannot tell whether the account has credit; the screen says so.
- The key is saved only if the test passes, encrypted inside the archive (`settings.sealed`). The screen
  is shown only its last four characters. It is sent to Anthropic and nowhere else.
- The key is NOT required to reach the home screen. Capture works without it until the interview (step 10).
- Console address used in the help text: https://platform.claude.com/settings/keys (from Anthropic's own
  "Get your Claude API key" page, checked 2026-11-11).
- The Setup tile now opens a setup screen holding: AI key, change passphrase, make a new recovery kit,
  and where the archive is kept.
- The automated screen check uses a stand-in for Anthropic (it has no real key). The real check is
  covered by unit tests with a fake network, and by the 401 observed above. The success case (HTTP 200)
  has not been seen by Claude with a real key; Marc's click-through is the first real one.

## Plumbing chosen at build step 5 (2026-11-11)

- Consent is recorded as video with sound from the default camera and microphone, in WebM. Echo checks
  the recording exists and is at least 10 seconds long. It cannot check the words were actually said;
  the playback step is where the person checks that themselves.
- The person types their full name; the statement is generated with that name and today's date, and the
  exact text shown is stored with the recording.
- Recordings are stored encrypted in `media/` inside the archive, in pieces of 1 MB, each tied to its
  file and position so a recording cannot be altered, reordered or cut short unnoticed.
- Echo's page may ask the computer for the camera and microphone and nothing else.
- Consent is not forced at start-up. The home screen is reachable, and every capture tile is blocked
  with "Needs your consent first" until it is given. `captureAllowed()` is the single check every later
  capture step must call.
- Withdrawing consent blocks capture at once and deletes nothing. Giving consent again needs a new
  recording. Earlier recordings stay in the archive. Export and delete arrive at step 21.

## Plumbing chosen at build step 6 (2026-11-11)

- Small structured data (people, consent, settings, and later advice) is kept as small encrypted
  documents inside the archive, one file per kind, each with its own key. No database is needed for these.
- The large store (memories, imported messages, the search index) is NOT chosen yet. It is decided at
  step 12, when the memory store is built, by trying an encrypted SQLite build in the automated checks
  on Windows first. This replaces the earlier note that it would be decided at step 6.
- The privacy rule lives in one function, `mayHear`: something for everyone reaches every person in the
  list; something for one person reaches only them; if that person is removed it reaches nobody and
  never falls back to everyone; someone not in the list is given nothing.
- Adding people does not need consent. It records who other people are, not the owner's likeness.
- Marking an item "for this person only" has nothing to attach to until step 8 (life stories), so the
  picker appears there. Step 6 delivers the people and the rule, with tests. This differs from the plan,
  which had Marc tag a test item at step 6.
- Each person has a "may talk to my echo" tick. Sub-project 4 uses it to decide who gets a login.

## Plumbing chosen at build step 7 (2026-11-11)

- The archive is already encrypted file by file, so the backup is a faithful copy of the same files in
  `Echo Backup` inside a folder the person chooses. It needs no key to make and opens only with the
  passphrase or recovery kit.
- The backup must be on a different drive from the archive. A folder on the same drive is refused.
- It runs by itself when the archive is opened, locked or closed, if the drive is plugged in. A missing
  drive never stops Echo opening or locking; the home screen says the backup is not up to date.
- Only changed files are copied, and each copy is checked against the original. Before a changed file
  is replaced, the copy it replaces is kept beside it as `.previous`, so one damaged file on the PC
  cannot wipe out the last good copy. Nothing is deleted from the backup automatically; that is handled
  with delete at step 21.
- "Check my backup" compares every file in the archive with its backup copy, byte for byte.
- Restore copies a backup into a new `Echo Archive` folder in Documents and never overwrites an
  existing one. It is offered when Echo has no archive or cannot find it.
- Closing Echo now waits for the backup to finish before the window goes.

## Plumbing chosen at build step 8, first half (2026-11-11)

- Step 8 is split in two pull requests. This half: record stories, play them back, type or correct the
  words, and the "who is this for" picker. Second half: speech-to-text on the PC. The split means the
  safe half lands even if transcription takes several attempts.
- A story is sound (an encrypted recording, WebM with Opus) plus words (encrypted text). The echo will
  read the words; the family can hear the sound.
- One recording is capped at 60 minutes. Longer stories are told in parts.
- Recording or changing a story is refused without consent in force. Deleting a story is always allowed.
- Deleting a story removes its recording from the archive. The backup keeps its copy until delete is
  built properly at step 21.
- The recorder shows a level bar so the person can see the microphone is hearing them before they talk
  for ten minutes.

## Plumbing chosen at build step 8, second half (2026-11-11)

- Speech-to-text runs on the PC with Whisper "base" (English only, 8-bit form) through the
  transformers.js library, inside the app's own process. Measured in the Windows checks on 2026-11-11:
  the model is 75 MB on disk, and 6.9 seconds of synthesised speech was written down word-perfect in
  1.7 seconds.
- The model is downloaded once from Hugging Face on first use, after the person agrees, and kept in the
  app's settings folder (outside the archive, never backed up). Recordings are never sent anywhere.
- The recording is decoded on screen to one channel at 16,000 samples a second, cut into parts of up to
  four minutes at quiet moments, and handed over part by part.
- A story that has just been recorded opens straight away and starts being written down. The words are
  put in the box, not saved, until the person has read them and pressed Save changes. Existing words are
  never replaced without asking.
- The first risk in the plan (speech-to-text good enough on an ordinary Windows PC) is settled for clean
  synthesised speech on a checks machine. It is NOT yet settled for Marc's voice, accent, microphone and
  laptop speed. If that falls short, the options to bring him are: the larger "small" model (slower,
  more accurate), or an opt-in cloud service.
- English only for now. Other languages need the multilingual model; that is a later decision.
- A manual "Update lockfile" workflow was added so future dependency changes do not need a temporary
  step in the checks.

## Plumbing chosen at build step 9 (2026-11-11)

- Face and voice recordings are "masters": kept at full quality, encrypted, for making the avatar and
  the cloned voice in sub-project 3. Nothing in sub-projects 1 and 2 uses them.
- Selfies: eight guided poses, taken from the live camera at the best resolution it offers, saved as
  JPEG. A pose can be retaken; the newest is shown.
- The guided video: one continuous take with on-screen instructions that change on a timer. At least two
  minutes is required (the figure the avatar vendors asked for when checked on 2026-11-10), and it stops
  itself at five. Recorded at up to 1080p, 6 Mbps video and 192 kbps sound.
- Voice: five passages to read and four things to talk about, written for this project. Recorded
  without the echo cancelling, noise removal and automatic volume that Windows applies to calls, at
  256 kbps, because a voice clone wants the voice as it is. A meter counts towards thirty minutes.
- One recording is handed to the app in one piece, up to 400 MB. That is enough for a five-minute video.
  Longer recordings would need streaming to disk; not needed yet.
- All three need consent in force to add, and can always be deleted.

## Plumbing chosen at build step 10 (2026-11-11)

- The interview has twelve parts (the spine in the spec, with "what you would tell each person" and
  "things you always say" as parts of their own). Each part opens with a fixed question, so a part can
  be started and read without the AI. Every follow-up is written by Claude from the answers so far.
- The interviewer is the person's own Anthropic key calling the Messages API directly. Model: Claude
  Sonnet (`claude-sonnet-5-5`); if Anthropic no longer offers that name, Echo asks which models the key
  can use and takes the newest Sonnet. One line why: Sonnet is the mid-priced model and a follow-up
  question is a small job.
- What leaves the computer, and only when a follow-up is asked for: the person's name from their
  consent, the names of their people with relationship and what they call the person, and the
  questions and answers so far in that one part. Recordings never leave. The screen says this.
- An answer is saved, encrypted, before anything is sent. If Anthropic cannot be reached, is out of
  credit or refuses the key, the answer is kept and the screen offers "Try again".
- An answer can be typed or spoken. A spoken answer is written down on this computer by the same
  speech-to-text as stories, shown for correction, and its recording is kept encrypted with the answer.
- The interviewer is told never to state or assume facts about the person, never to summarise them
  back to themselves, and to back off at once if they would rather not answer. "Ask me something
  else" skips a question without saving anything.
- A part ends when the interviewer says it is covered, when the person says they have said enough, or
  after twelve answers. A finished part can be carried on.
- Every answer is for everyone unless the person marks it for one person alone, under the answer. This
  is the same rule as stories and closes a gap: the spec gives every memory a privacy tag.
- The record of activity notes that a question was answered and in which part, never the words.
- Not checked by anything automatic: a real conversation with Anthropic. The checks use a stand-in
  interviewer. The first real call happens on Marc's PC with his key.

## Plumbing chosen at build step 11 (2026-11-12)

- A piece of advice is for one named person and one occasion, and is one of two kinds, as decided in
  round 2: "when they ask" (the echo brings it up when the conversation reaches the occasion) or
  "keep it for the day" (held back until the day).
- Advice is only ever shared with the person it is for. There is no "everyone" option. This is the
  private choice and can be widened later if Marc wants others to hear it too.
- "Keep it for the day" can carry a date when the date is known (a birthday) and none when it is not
  (a wedding). How it is delivered on the day is still for sub-project 4, as the spec says; the screen
  says so rather than promising a delivery that does not exist yet.
- Advice can be typed or spoken. Spoken advice is written down on this computer for correction and
  its recording is kept encrypted, so the real recording is there to be used on the day.
- The occasions offered are a starting list written for this project; any other can be typed.
- The box that takes typed or spoken words is now one shared piece, used by the interview and by
  advice, instead of a second copy.
- Changing advice changes its details and words. To record it again, delete it and add it again.

## Plumbing chosen at build step 12a (2026-11-12)

- Step 12 is delivered in two parts, like step 8: 12a is the memory store, 12b is the character sheet
  and the style profile.
- **The large store is one encrypted document, not SQLite.** This settles the choice left open at
  step 6. One line why: at this app's size it is fast enough, and it leaves no database engine to
  compile for every Electron release and every user's PC. Measured in the automated checks at 50,000
  passages: about 21 MB on disk, saved in about 0.2 s, loaded in about 0.2 s, searched in about
  0.01 s (cloud workspace; the Windows run prints its own figures). The note at step 6 said this would
  be decided by trying an encrypted SQLite build first. That trial was NOT run: the measurement made
  it unnecessary. If imports at steps 15 to 20 push past this, SQLite is the fallback and the checks
  will show it, because the 50,000-passage test fails when any of the three takes too long.
- Passages are cut from the person's own words: stories that have been written down, interview
  answers, and advice. No AI writes or rewrites a passage, and nothing is sent anywhere to build the
  store. Cuts fall at paragraphs, then sentence ends, at 120 words at most.
- Each passage carries where it came from, its date, who may hear it, and the people involved. People
  involved are those in the People list named in the passage, plus the person it is for. Names only;
  nothing is guessed from words like "my wife".
- An interview answer's passage keeps the interviewer's question as context, never as the memory.
- Advice kept for the day is in the store but marked so the echo cannot use it in conversation.
- The person can correct a passage's words, change who may hear it, leave it out and put it back. The
  original wording is always kept underneath, and the recording or source is never changed from here.
- The store is brought up to date whenever it is read. What the person did to a passage is carried
  over as long as the source still contains that passage word for word.
- Fail-safe for privacy: if a source's words change under a passage the person had marked (left out,
  made private or corrected), the new passages from that source are held back, and the echo cannot
  use them until the person has looked. A private passage can never come back unnoticed.
- Leaving a passage out is always allowed. Anything that lets the echo say more (new words, a new
  audience, putting a passage back, releasing a held one) needs consent in force.
- The home screen has a new section under the tiles, "What your echo is made from". The character
  sheet and style profile join it at 12b.

## Plumbing chosen at build step 12b (2026-11-12)

- The character sheet and the style profile are short first-person lines in fixed sections.
  Character: what matters most, beliefs, humour, temperament, what I would never say or do. Style: how
  I talk, words and phrases, how I start and finish, how I talk to each person.
- Claude drafts the lines on the person's own key (same model choice as the interview). Every drafted
  line must name the passages it rests on. Echo drops any line with no real passage behind it, any
  line in a section that was not asked for, and anything over ten lines a section.
- Privacy by construction: general lines are drafted only from passages meant for everyone. Lines
  about how the person talks to one named person are drafted only from passages meant for that
  person, in a separate request, and are marked for that person alone. Left-out and held passages,
  and advice kept for the day, are never sent.
- What leaves the computer when drafting: the person's name, the passages chosen as above, lines the
  person has struck out, and for the style profile the measured sentence length. For lines about one
  person, also that person's name and relationship.
- A drafted line is used by the echo while a passage still stands behind it. If its passages are
  later left out or removed, the echo stops relying on it until the person confirms it. A line the
  person wrote, corrected or confirmed is always used. Drafted lines are in use before the person
  has checked them; the home screen counts the ones not yet checked. Whether unchecked lines should
  be held back until confirmed is Marc's call (asked at step 12b).
- "Not me" strikes a drafted line out and remembers it: the next draft is told not to suggest it, and
  Echo drops it if Claude does. Drafting again keeps every line the person wrote, corrected or
  confirmed, and replaces only unconfirmed drafted lines.
- The style profile also shows sentence length measured on this computer with no AI. Until messages
  are imported (steps 15 to 20) it is drafted from transcripts and typed answers only, so the
  "words and phrases" section will be thin; each import step redrafts it.
- Striking a line out is always allowed. Drafting, adding, correcting and confirming need consent in
  force. Every draft and change is on the record of activity, without the words.
- Not checked by anything automatic: what Claude really writes from real passages. The checks use a
  stand-in.

## Plumbing chosen at build step 13 (2026-11-12)

- **How a reply is made:** work out who is speaking, drop everything not meant for them, choose the
  passages, draft, check, and only then show it. One line why: nothing unchecked ever reaches the
  screen.
- **Who is speaking:** "Myself, trying it out" or any person marked as allowed to talk to the echo.
  As himself, the owner gets only what is for everyone, which is what any family member would get. A
  named person gets that plus what is for them alone. Someone not allowed, or not in the list, gets
  nothing and nothing is sent.
- **Which passages:** if everything permitted fits (about 24,000 characters), all of it is sent. If
  not, the passages that best match the last two things the person said are chosen by word matching
  on this computer, with a lift for passages involving the listener and for advice meant for them.
  Word matching misses passages that use different words for the same thing; if the blind test at
  step 14 shows that, the fix is meaning-based search with the speech model already on the PC.
- **The source check is a second request to Claude**, told to be strict: it gets the passages, the
  recent conversation and the draft, and lists anything stated as the person's memory or life that no
  passage supports, and any claim to be the living person. A failed check throws the draft away and
  asks for one redraft, with the reasons. If that fails too, the person is shown the fixed line "I
  never got round to telling Echo about that one". A checker that cannot be read counts as a failed
  check. So each reply costs two requests on the person's key, up to four when a draft is thrown away.
- **The opening line** is written by the app, not Claude, opens every conversation, and cannot be
  switched off. Claude is told it has been said and must say plainly that it is an AI echo if asked.
- **The three kinds of statement** (memory, view, nothing) are in the echo's instructions and are
  what the checker enforces.
- **Advice:** "when they ask" advice is given to the echo marked with its occasion, to bring in when
  the conversation gets there. "Kept for the day" advice is never sent.
- **What each person tells the echo** is kept per listener, encrypted, apart from everyone else's.
  A new conversation keeps the earlier ones; the echo is given what that listener said before (the
  latest 3,000 characters), marked as theirs and never as the person's memory. Nothing said in a
  conversation changes the memory store.
- **Sources:** every reply keeps the passages it drew on and how it got through the check. The screen
  shows them under each reply, including what the checker objected to in a draft that was thrown
  away. The record of activity keeps the passage ids and the outcome, never the words.
- **Distress:** the echo is told to step out of the person's voice, say it is an AI echo, and point to
  someone close, a doctor or a crisis line if the listener is in real distress.
- **Third-party words:** there are none in the archive until messages are imported (step 15 on), so
  that check is added with the imports.
- The echo will not talk unless consent is in force.
- What leaves the computer for each reply: the person's name, the listener's name and relationship,
  the character sheet and style profile lines the listener may hear, the chosen passages, what the
  listener said before, and the conversation.
- Not checked by anything automatic: anything the real Claude says or how strict the real checker
  is. The checks use a stand-in that invents a memory on purpose and confirm it is never shown.

## Plumbing chosen at build step 14 (2026-11-12)

- The twenty questions are a fixed list written for this project: a mix of views ("What does a good
  friend do?") and memories ("What is the best place you have ever been?"). They cannot be reworded
  yet.
- The person's own answers are stored encrypted with the test, in a file the memory store never
  reads, so they cannot reach the echo. The spec says "kept out of the archive"; this build keeps
  them out of everything the echo draws on, but they do sit in the archive folder, encrypted, because
  the test needs them for judging. Say if they should be deleted once a test is finished.
- The echo answers each question as it would to any family member (only what is for everyone),
  through the same draft and source check as any reply, and is told it is giving one answer, not
  holding a conversation, so its answers are not given away by a question back.
- **A reading of the spec that Marc should know about:** the spec says a judge "picks which is the
  real Marc, and scores the echo's answer from 1 to 5". A judge who does not know which answer is the
  echo's cannot score it. So the judge scores BOTH answers for how much they sound like the person,
  then picks the real one, and the echo's score is the one given to the echo's answer. Nothing is
  revealed between pairs.
- **A second reading:** "the echo averages 4 out of 5 or better" is taken across all finished judges
  together. The limit of 13 real picks in 20 applies to each judge separately.
- Judges are the person and any family member allowed to talk to the echo. Each judge gets their own
  shuffled order and their own left and right. The screen is only ever given unlabelled pairs while
  judging; results, and which answer was which, appear once the person and at least one family member
  have finished.
- Judging happens at this computer, one judge at a time.
- The spec says the model is "chosen by measured results in the blind test". Only one model is wired
  in, so there is nothing to choose between yet. A failed test is first a prompt and material
  problem; a second model can be compared here if that does not fix it.
- Starting a new test keeps the earlier one in the archive.

## Plumbing chosen at build step 15 (2026-11-12)

- **Marc chose to go on to imports without a real blind test.** The plan says a far-off blind test is
  fixed in the engine before time is spent on imports. No real test has been run and nothing has made
  a real call to Anthropic from the app. He said "merge 18" after being told this.
- **One importer, one small reader per service.** The importer handles preview, the owner's choices,
  storage, the memory store and the checks. WhatsApp is the first reader.
- **WhatsApp reader** (format checked on the web 2026-11-12, NOT against a real export of Marc's):
  reads the ZIP WhatsApp makes, or the text file inside it. Accepts the iPhone layout
  (`[date, time] Name: message`) and the Android layout (`date, time - Name: message`), day-first,
  month-first and year-first dates, two or four digit years, 24-hour and am/pm times, and messages
  over several lines. Lines with a time and no sender are WhatsApp's own notices and are left out,
  as are attachments, deleted messages and the encryption notice. English wording only. If no date
  in a file settles day-first against month-first, day-first is assumed and the preview says so.
- **The ZIP is read by a small reader written for Echo**, using only what comes with Node. One line
  why: no new package to trust with private messages, and only the chat text is read from disk, so a
  ZIP full of photos is not unpacked.
- **Nothing is saved until the owner has seen a preview** and said which sender is them, what to call
  the conversation, who it is with, and who may hear what they said in it.
- **Who may hear the owner's words from a conversation** is chosen at import: only the person it was
  with (the default when that person is in the People list), everyone, or nobody (kept in the
  archive, not used by the echo). General style lines are still drafted only from what is for
  everyone, so ordinary chat has to be marked for everyone to teach the echo how he talks in general.
- **Other people's words:** every message not from the chosen sender is marked as someone else's at
  import, and nothing in the app can change the mark. They are stored encrypted on this computer so
  the conversation can be read, and that is all. They are never a source for the memory store, never
  in the character sheet or style profile, never sent to Claude. This is stricter than decision A,
  which would allow them to go to Claude in passing as context; that is not used.
- **The reply check for other people's words** runs on this computer, before the Claude check: a
  draft that repeats eight words in a row from someone else's message is thrown away and redrafted.
- **The owner's words** go into the memory store as passages. Messages sent one after another, with
  nobody else speaking in between and no gap over ten minutes, are joined into one. Anything under
  three words is left out as saying too little. A passage from a message carries no context,
  because the context would be someone else's words.
- The same export cannot be imported twice. A newer export of the same chat is a separate import;
  delete the old one first.
- Deleting a conversation removes its messages and takes its passages out of the memory store.
  Importing needs consent in force; deleting does not.
- The exported file itself is not encrypted and is outside Echo. The screen tells the owner to delete
  it, and the copy they sent themselves, once it is imported.
- The style profile is not redrafted automatically after an import, because that spends the owner's
  credit. The screen offers it.
- The memory store is now cached while nothing it is built from has changed, and bringing it up to
  date looks passages up by source. Measured in the checks: 20,000 sources brought up to date in
  about 0.2 s.

## Plumbing chosen at build step 16 (2026-11-12)

- Built without knowing whether Marc's export from Meta has arrived (asked, not answered). The plan
  says this step moves later if it has not; it was built from the published format instead, because
  no importer can be checked against a real export until Marc has one. It is NOT verified against a
  real download.
- **Both of Meta's downloads are read** (formats checked on the web 2026-11-12):
  the standard "Export your information" in JSON (a folder per conversation holding `message_1.json`,
  `message_2.json`, with `title`, `participants`, and messages carrying `sender_name`, `timestamp_ms`,
  `content`), and "Download secure storage data" for end-to-end encrypted chats (a file per
  conversation with `threadName` and messages carrying `senderName`, `isUnsent`). The field names
  `text` and `timestamp` in the encrypted layout were not confirmed by a source and are accepted
  alongside the standard ones, so either spelling is read.
- Older exports write accented letters and emoji as their UTF-8 bytes one at a time. That is put
  right on reading. Text that is already right is left alone.
- Lines Messenger writes itself ("sent an attachment", reactions, calls, nicknames, unsent messages)
  are left out, by the message's type and by wording. The wording list is English only and from
  memory, not from a source; a real export will show what it misses.
- **A download holds many conversations.** Echo lists them from the file names, biggest first, and
  the owner opens and imports them one at a time through the same preview as WhatsApp. Nothing is
  unpacked to disk: only the conversation being opened is read out of the ZIP.
- The ZIP reader now handles big ZIPs (over 4 GB or over 65,535 files), which Meta's exports with
  photos can be.
- Echo suggests which sender is the owner from earlier imports, or from their name on the consent.
  The owner still confirms it.
- Times are stored as the date and time on this computer's clock, the same as WhatsApp's.
- One importer serves both services: preview, choices, storage, the memory store and the checks on
  other people's words are shared. Adding Messenger added a reader and a list of conversations.

## Plumbing chosen at build step 17a (2026-11-12)

- Step 17 is delivered in two parts. 17a reads an iPhone backup that is not encrypted. 17b adds
  encrypted backups, which need the backup password and a good deal of Apple's key handling.
- **How messages are found** (checked on the web 2026-11-12, NOT against a real backup): a backup is
  a folder of files named by the SHA-1 of where they were on the phone. The messages are
  `HomeDomain-Library/SMS/sms.db`, which gives the name `3d0d7e5f...`; Echo works the name out rather
  than hard-coding it, and the checks confirm it comes to the published value. Newer backups sort
  files into folders by the first two characters of the name, older ones do not; both are tried.
- **Where backups are looked for:** `%APPDATA%\Apple Computer\MobileSync\Backup` (iTunes from Apple's
  site) and `%USERPROFILE%\Apple\MobileSync\Backup` (Apple Devices, and iTunes from the Microsoft
  Store). The person can also pick a folder.
- **The database is read with the SQLite reader built into Node** (`node:sqlite`), so there is still
  no database package to compile. Node marks it experimental and prints a warning. The Windows screen
  check builds and reads a backup inside the running app, which proves it works in Electron 45.
- The backup is opened read-only, where it is. Nothing is copied out of it and nothing in it changes.
- Newer iPhones leave a message's plain text empty and pack the words into a block (Apple's
  "typedstream"). Echo reads the words from after the marker "NSString". **That layout is from
  memory, not from a source, and has only been tested against a block Echo built itself.** A real
  backup will show whether it is right; if it is wrong, those messages will show as having no words.
- Times are counted from the start of 2001, in billionths of a second on newer phones and in seconds
  on older ones. Both are read. Tapbacks ("Loved", "Laughed at") are left out.
- Names come from the contacts in the same backup, matched on the last nine digits of a phone number
  or the whole of an email address. The contacts layout is also from memory; if it cannot be read,
  people are shown by number.
- On the phone, the owner's messages carry no name. They are given the name on the consent. If
  someone else in the conversation has that same name, the owner is marked "(this iPhone)", so the
  owner and another person can never be merged into one sender.
- **Known limit carried by WhatsApp and Messenger:** those exports identify people only by display
  name. Two people with exactly the same name in one group conversation cannot be told apart, and if
  one of them is the owner, the other's messages would be treated as the owner's. Not fixable from
  the export; the preview's sender list is where it would show.
- An encrypted backup is recognised (its messages file is not a readable database) and refused with
  what to do. A backup with no messages says that messages kept in iCloud may be left out.

## Plumbing chosen at build step 17b (2026-11-12)

- **How an encrypted backup is opened** (scheme checked on the web 2026-11-12, NOT against a real
  encrypted backup): the backup's `Manifest.plist` holds a bag of keys, each locked. The backup
  password is stretched twice (PBKDF2 with SHA-256, then with SHA-1, using the salts and round
  counts in the bag) into a key that unlocks the bag. One of the unlocked keys opens the backup's
  index (`Manifest.db`); the index holds, for each file, the key that opens that file.
- **The key-unlocking step (AES key wrap, RFC 3394) is written by hand** on top of plain AES.
  Electron ships a different cryptography library from Node, and it may not carry the ready-made
  key-wrap cipher. The hand-written version is checked against the published RFC test vector in the
  automated tests, and again inside the running app by the Windows screen check.
- **The backup password is never stored and never written to the activity log.** It is used to
  unlock the bag and dropped. The one key needed to read the messages is held in memory while that
  backup is the one open in Echo, and wiped when another backup or download is chosen and when the
  archive locks.
- **A decrypted copy does touch the disk, briefly.** The SQLite reader built into Node can only read
  a file, so the messages database (and the index, and the contacts) are each decrypted into a
  private folder in the Windows temp folder, read, and deleted in the same step, including when
  reading fails. On start-up Echo also clears any copy a crash left behind. **Known limit:** it is a
  plain delete, not a shred, so on some drives the data could in principle be recovered until it is
  overwritten. Avoiding the copy altogether would mean adding a compiled database package, which
  step 12a decided against.
- A backup that says it is not encrypted and has no messages file is told apart from an encrypted
  one, so nobody is asked for a password that could not help. The password is asked for again only
  when it was wrong.
- Only backups with a `Manifest.db` index are read (iOS 10 and later). Older ones are refused.
- **Tested only against an encrypted backup Echo's own tests build.** That backup is built from the
  same reading of the scheme, so a misreading would pass the tests and fail on a real one. Marc's
  first encrypted backup is the real check.

## Plumbing chosen at build step 18 (2026-11-12)

- **What Discord's package is** (Discord's own help page, read 2026-11-12): a ZIP with a messages
  folder holding one sub-folder per direct message, group or server channel, each named with the
  channel's ID; a JSON file mapping channel IDs to names; and for each message an ID, Timestamp,
  Contents and Attachments. It holds only what the person sent. Discord says it can take up to 30 days.
- **What Discord's page does not say, and Echo therefore reads forgivingly** (NOT checked against a
  real package): the file names (`messages.json`, `index.json` are from other people's descriptions
  of packages; `messages.csv` for older packages is from memory), whether folders start with "c",
  and how the time is written. Echo accepts the folder with or without "c", JSON or CSV, field names
  in either case, and times with or without a zone. **A time with no zone is taken as UTC; that is an
  assumption.** If it is wrong, every message will be out by the same number of hours.
- Everything in a package is the owner's, so nothing from Discord is ever marked as someone else's
  words, and the owner is known without asking. Their messages are given the name on the consent.
- **Limit that cannot be fixed from the package:** there are no replies around the owner's messages,
  so Echo cannot tell where someone else spoke in between. Messages sent within ten minutes of each
  other are joined into one memory, as in every other import.
- Discord's own codes are taken out of the words: custom emoji become their names (`:thumbsup:`),
  and mentions of people, roles and channels, which the package writes as numbers, are dropped.
  Messages with an attachment and no words are counted and left out.
- Conversations are listed by the name in the package's index and imported one at a time, like
  Messenger, because who may hear each one is the owner's choice. A package can hold hundreds of
  channels, so this is slow for someone who wants all of them: an open question for Marc.
- One channel's messages file from an unzipped package can be given on its own.

## Plumbing chosen at build step 19 (2026-11-12)

- **Email comes from a mailbox file, not a mail connection.** The spec left this to the email PR. A
  connection would mean Echo holding a mail password or a Google sign-in, and Google sign-in for
  reading mail needs an app registered and reviewed by Google: accounts and hosting, which Echo does
  not build. A mailbox file (`.mbox`) is what Gmail's export gives and what most mail programs can
  save, and it is read on this computer like every other import. Marc can overrule this.
- **Only emails the owner sent are read.** The owner first says which of the addresses in the
  mailbox are theirs (Gmail's "Sent" label is used to suggest them). Other people's emails are
  looked at for who they are from and to, and nothing else. They are not stored, not even locked
  away as other people's chat messages are: a mailbox is mostly other people's words and there is
  no reason to keep them.
- **Rule 6 for email rests on cutting off quoted text.** A reply usually carries the email it
  answers underneath. Echo cuts an email at the first sign of quoted text: a line starting with
  ">", "On ... wrote:" (and the French, Spanish, German, Italian and Dutch forms), "Original
  Message", "Forwarded message", Outlook's rule line or its "From: / Sent:" block, and in HTML
  email the quote box. Everything after that point is dropped, including anything the owner typed
  in between quoted lines: safe, not complete. A line of the owner's own that starts with ">" or
  looks like one of these also cuts the email short.
  **Known limit:** an email program that quotes with none of these marks would get through, and
  the quoted words would be taken as the owner's. The preview shows the first emails and says to
  check them; the stored conversation can be read in full. The list of marks is from memory, not
  from a survey of mail programs.
- A reply's or a forward's subject was written by someone else, so only a subject the owner chose
  is kept (as the first line of that email's words).
- Signatures are cut at the standard "-- " line and at "Sent from my ...".
- Left out: drafts, anything in Gmail's Spam or Bin (the owner threw it away), automatic replies,
  the same email twice, and emails with no readable date.
- Emails are grouped by the first person on the To line and imported one group at a time, because
  who may hear each is the owner's choice. An email to several people sits with the first.
- The file is walked from start to end without loading it, so a mailbox of many gigabytes is fine.
  Only the first 2 MB of each email is looked at (the words come first; what is cut is attachments).
- The mailbox must be unzipped first; Echo's ZIP reader holds a whole file in memory and a mailbox
  can be far too big for that. Outlook's `.pst` is not read.
- How to get the file from Gmail (Google Takeout: Mail only, untick "Include all messages in
  Mail", pick Sent) is from university help pages read 2026-11-12, not from Google's own page.

## Plumbing chosen at build step 20 (2026-11-12)

- **Only letters the owner wrote are kept.** A letter someone wrote to them is that person's words:
  the echo may not quote it (rule 6) and it says nothing about how the owner talks. The owner ticks
  "I wrote this letter myself" before anything else can happen. Marc decided on 2026-11-12 that
  letters written to the owner are not kept at all.
- **A page is read by the AI service, with the owner's own key.** Chosen over reading on the
  computer because it reads handwriting, which the free readers that run on a computer mostly
  cannot, and it adds nothing to install. The cost: the picture of the page goes to Anthropic. The
  screen says so beside the button, and the button is dead until the owner has said the letter is
  theirs. The owner can skip reading and type the letter instead; nothing then leaves the computer.
- **What is read is never trusted.** The reader is told to copy, not improve, and to put `[?]`
  where it cannot read a word rather than guess. A letter cannot be saved while a `[?]` is left in
  it, or until the owner ticks that they have read the words against the page. Reading another
  page unticks that box. This is what stops a misread word becoming something the echo "remembers".
  **Known limit:** the reader can still misread a word confidently, with no mark. Only the owner's
  own check catches that.
- Each page picture is made smaller on the screen before it is kept or sent (longest side 2000
  dots, JPEG), which keeps it well under the AI service's 5 MB limit for a picture. The pictures are
  kept encrypted with the letter and shown beside its words when it is opened again. Pictures
  cannot be added to or taken from a letter after it is saved.
- JPEG, PNG and WebP pictures only. **Not read:** iPhone photos saved as HEIC, and PDF scans.
- When it was written can be a year, a month or a day, as far as the owner knows. The echo is told
  it as part of the letter's name, not as an exact date.
- How a picture is sent to the service was checked against Anthropic's documentation on
  2026-11-12. No real page has been read: the automated checks use a stand-in for the service.

## Plumbing chosen at build step 21 (2026-11-12)

- **The copy of everything is not encrypted, on purpose.** "Exportable" means it opens without
  Echo, years from now, on any computer: words as `.txt`, recordings and pictures as the files they
  are, and everything else as `.json`. The screen and a `README.txt` at the top of the copy both
  say plainly that anyone who can open the folder can read all of it.
- **Other people's imported messages are in the copy**, marked "(theirs)". They came from the
  owner's own exports and the copy goes only to the owner. Rule 6 is about what the echo says, and
  the echo never sees the copy.
- **Not in the copy:** the passphrase, the recovery code and the AI key. A test checks the
  passphrase and key are in no file of it.
- Taking a copy is always allowed, with or without consent in force, and is written to the
  activity log. It goes into a new dated folder inside the one chosen, never into the archive.
- **Deleting one thing** was already there on each screen (story, advice, letter, recording,
  imported conversation, person, sheet line; a memory passage can be left out). Removing the source
  removes its passages, so the echo stops being given it at once. A test now proves that.
  **Known limit:** a character-sheet or style line drafted from a passage stays after the passage
  goes, and earlier conversations keep what the echo said at the time.
- **Deleting all conversations** is new, for that reason.
- **Deleting everything asks for the passphrase again**, so someone who finds Echo left open
  cannot do it. It removes the archive folder (only if it is named and laid out as Echo makes it),
  forgets where the archive was, and removes the backup too if asked and its drive is there. If the
  drive is not there the screen says the backup is still on it. The copies made by "Take a copy"
  are never touched.
- **It is a plain delete, not a shred.** Everything stored was encrypted, so recovering the files
  from the drive would not be enough without the passphrase. That is said on the screen.
- Spec says "the heir can pause or delete it". The heir's side is sub-project 4. This step is the
  owner's own delete; pausing is not built.

## Plumbing chosen at build step 22 (2026-11-12)

- **The installer is made with electron-builder (NSIS).** It is the most used tool for this, makes
  one `.exe`, and needs no administrator: Echo installs for the one Windows account, in that
  account's own programs folder, with Start menu and desktop shortcuts. The installer is about 220 MB,
  most of it the speech-to-text engine.
- **The installer is not signed.** Windows shows "Windows protected your PC" and the person has to
  choose "More info", then "Run anyway". Signing needs a certificate that is bought from a
  certificate company and renewed; whether to buy one is Marc's decision and has not been priced.
- **Uninstalling never touches the archive or the settings.** The archive is a folder the person
  chose, outside the program.
- **The installed app is checked, not just the source.** Every pull request now builds the
  installer on Windows, installs it silently, and runs the installed `Echo.exe` through the same
  screen check as before, from first run to deleting everything. That is what proves the packed-up
  app works: the speech-to-text engine, the iPhone database reader and the file paths all behave
  differently once packed.
- **No automatic updates.** A new version is a new installer run over the old one. The archive
  and settings carry over because they are outside the program.
- **Where to get it:** the "Release" workflow, run by hand, builds from `main` and attaches the
  installer to a GitHub release. The repository's visibility decides who can download it. Nothing
  else is hosted.
- The app's identifier is `io.github.madhatt4.echo` and its icon is a placeholder drawn for this
  step. Both are Marc's to change; the identifier should be settled before strangers install it.
- **The home screen now says what to do next**: consent, then the AI key, then some words (the
  interview), then talk to the echo. That is the path from nothing to a first conversation.
- **The wording pass was a search, not a read-through.** Every screen was searched for words only
  the builders would know ("build step", "tell Claude") and three lines were put right. Nobody
  who has not seen Echo before has yet used it. The plan's test for this step, a stranger going
  from nothing to a first chat without help on a clean PC, is Marc's to run and is the real pass.

## Decisions on the assistant door (Marc, 2026-11-13)

- Marc's AI assistant, Jarvis, runs on the same PC and is to be able to read his words in Echo, put
  things in for him, and talk to his echo. Design: `docs/spec-jarvis-door.md`.
- **Marc chose "any time, on its own"** over "only while Echo is open", having been told that
  anyone who gets into Jarvis then gets into Echo. The design limits that by giving Jarvis a small
  store of its own instead of the archive's key.
- What Jarvis puts in waits for Marc's approval. Jarvis talks to the echo as itself, marked as an
  assistant and not family. This is an exception to rule 4 that Marc made himself.
- Jarvis uses both MCP servers and shell commands, so the door is built as both.

## Plumbing chosen at door PR A (2026-11-13)

- The assistant's store is a folder called `assistant-door` beside Echo's settings file (on
  Windows, in the Echo folder under `%APPDATA%`), holding two files: `door-key.json`, a random key of
  its own, and `store.sealed`, encrypted with that key. Neither is made from, or holds, the
  archive's key. A test proves the door's key cannot open a file in the archive.
- **What goes in is decided in one place** (`src/shared/door.ts`): passages the echo itself may use
  that are marked for everyone, and sheet lines in use that are for everyone. So advice (always for
  one named person), words for one person, left-out and held passages, and other people's words
  are never in it.
- **The store is rewritten** whenever Echo works out afresh what the echo can draw on (which it
  does after any change, the next time a screen asks), and once more as the archive locks. So what
  the assistant reads is at most one screen behind while Echo is open, and exact once it is locked.
- **Withdrawing consent turns the door off and deletes the store.** So does "Delete everything".
  The door cannot be turned on without consent in force.
- Turning the door on and off is written to the activity log.
- **Two things the spec put in the store are held back until the PR that needs them (E):**
  - the AI key. Nothing before PR E uses it, so it is not exposed before then.
  - the fingerprints of other people's eight-word runs. On reflection they are weaker than the spec
    implied: someone holding the store could test guesses against them and walk a conversation back
    out a word at a time. PR E will decide between leaving them out (the assistant's echo would then
    run without that one check, though it is never given other people's words to repeat) and a
    form that cannot be walked back. That is a change from the approved spec and will be put to Marc.

## Plumbing chosen at door PR B (2026-11-13)

- **The command is `echo-door.cmd`, installed beside `Echo.exe`.** It runs a small script on the
  copy of Node inside Echo (the same way VS Code's `code` command works), so nothing else needs
  installing. It is not put on the PATH; Setup shows the full line to give the assistant.
- **Commands:** `status`, `search <words>`, `read` (all, by kind, or one by id), `sheets`, `help`.
  Each prints JSON and sets an exit code: 0 worked, 1 the door is off or has nothing, 2 not
  understood. There is no command that changes anything.
- **Search is by words, not by meaning:** a passage scores by how many different words of the
  question it holds, small words not counting, ties to the newer. It is the same kind of matching the
  echo itself uses. An assistant that wants more can read everything and judge for itself.
- **The command reads only the door's own store.** It never opens the archive and could not: it has
  no key to it. It opens no network port, and stops as soon as it has answered.
- **Each use is written down beside the store** (when, what kind, how many results; never the words
  searched for or returned), and Echo copies those into the activity log, gathered by day, the next
  time the archive is open. **Known limit:** that list is a plain file the assistant could alter. It
  is a record of what a well-behaved assistant did, not proof against one that is not.
- The check on the installed app now runs the installed `echo-door.cmd` against a store written by
  Echo's own code, with Echo not running.

## Plumbing chosen at door PR C (2026-11-13)

- **`echo-door mcp` runs the door as an MCP server** on standard input and output, offering four
  tools: `echo_status`, `echo_search`, `echo_read`, `echo_sheets`. They do exactly what the shell
  commands do, through the same code, so the two cannot drift apart. No tool changes anything.
- **Written by hand, no library.** The messages are few and fixed, so the door adds nothing to
  Echo that has to be trusted or kept up to date.
- **It speaks the form of MCP that starts with an "initialize" handshake**, versions 2025-11-25,
  2025-06-18, 2025-03-26 and 2024-11-05 (checked against the protocol's own pages on 2026-11-13).
  The newest form, 2026-07-28, has no handshake. That version says an assistant speaking both
  should probe first and fall back to the handshake when the probe is refused; the door refuses
  the probe so that happens. **Known limit:** an assistant that speaks only the 2026-07-28 form
  cannot use the door as an MCP server. It can still use the shell commands. The newer form will
  be added if Jarvis turns out to need it.
- Nothing is answered before the handshake. Nothing but protocol messages is ever written to
  standard output. The server stops when the assistant closes its end.
- **Setup shows a settings block to paste**, in the `mcpServers` layout most assistants use. When
  installed it starts `Echo.exe` directly with `ELECTRON_RUN_AS_NODE=1` rather than the `.cmd`
  file, because many assistants cannot start a `.cmd` file.
- Uses through MCP are written down and shown in the activity list exactly as shell uses are.
- The check on the installed app now starts the installed door as an MCP server, shakes hands,
  lists the tools and runs a search.

## Plumbing chosen at door PR D (2026-11-13)

- **The assistant can leave two kinds of thing in a tray:** a pointer to a file on this PC worth
  importing (only its path; the door never reads or copies the file), and a draft of something
  the owner told it. New commands `suggest-file`, `suggest-words`, `tray`, `withdraw`, and the
  matching MCP tools. A long draft can come on standard input.
- **The tray is in the door's folder, sealed with the door's key**, one file per thing. Nothing in
  it is in the archive, in the memory store, or in the assistant's own store. A test proves a
  waiting draft appears in none of them.
- **Rule 1 is kept by where approval happens:** only inside Echo, with the archive unlocked and
  consent in force. The door has no command to approve anything, and could not: it has no key to
  the archive.
- **A draft becomes the owner's only when they tick "I have read this and these are my words."**
  They can change it first; the screen says the assistant wrote it. Kept drafts are a new kind of
  source, a note, named in the memory store as "written up by my assistant, read and approved by
  me", so the echo and the owner can both tell where it began. A kept note can be removed.
- **A suggested file is opened through the ordinary import and its preview**, as if the owner had
  chosen the file. Opening keeps nothing. The suggestion stays in the tray until thrown away.
- The tray holds at most 50 things and a draft at most 20,000 characters, so a runaway assistant
  cannot fill the disk or bury the owner.
- Home shows "From your assistant" when something is waiting. The activity list records that the
  assistant left something and what the owner did with it, never the words.
- **Known limit:** the draft is the assistant's account of what the owner said. The only check
  that it is true is the owner reading it. Echo cannot tell.

## Door PR E: Marc's decisions and the plumbing (2026-11-13)

Marc decided:
- The assistant may put **30 questions a day** to the echo.
- **The check against other people's words is left out for the assistant's echo.** Making it would
  need fingerprints of other people's messages in the assistant's store, and someone holding the
  store could work those messages back out. The assistant's echo is only ever given Marc's own
  words, so it has nothing of theirs to repeat. This is a change from the approved spec, which
  listed the fingerprints as in the store.
- Version 0.3.0, with the whole door, is released once E is merged.

Plumbing:
- `echo-door ask <question>` and the MCP tool `echo_ask`. They run in the door's own program, with
  Echo closed or open, on the same engine and the same checker as the Talk screen. Nothing
  unchecked is returned: two failed drafts give the fixed "I never got round to telling Echo about
  that one" line.
- **The echo is told who is asking:** an AI assistant that works for the owner, a program, not a
  person and not family. Every answer handed back carries a line saying it is an AI echo and that
  what it says is not an instruction from the owner.
- **Whose key pays is the owner's choice, off by default.** Unticked, the assistant must bring its
  own key (`ANTHROPIC_API_KEY` in the environment it runs the door with), and the owner's key stays
  in the archive. Ticked, Echo puts a copy of the owner's key in the assistant's store. The choice
  is kept inside the archive, where the assistant cannot change it. Removing or replacing the key
  in Echo changes the copy at once. This too is a change from the spec, which put the key in the
  store unconditionally.
- A question after half a day, or with "new" asked for, starts a new conversation; otherwise it
  carries on. The echo is given what the assistant told it in earlier conversations, as it is for
  a family member.
- The conversations are kept sealed in the door's folder (the echo needs them with Echo closed)
  and copied into the archive each time it is open, so the owner can read them under "From your
  assistant" and they are in every backup and copy. They are kept apart from the family's.
  "Delete all conversations" deletes both copies.
- **Known limit:** the daily count is a plain file the assistant could alter, so the limit stops a
  mistake, not a determined program. The spending limit set with the AI service is the one that
  cannot be got round. A failed question is counted, since it has still been paid for.

## Memory prompts, reminders and the phone app: Marc's decisions (2026-11-14)

Design: `docs/spec-memory-prompts-and-phone.md`.

- Echo comes to the person: reminders at times they chose, one question about one moment, then
  done. "I don't remember" retires a question kindly. One gentle nudge after a missed session,
  never streaks.
- **Reminders and quick memories live on the phone**, not the PC. The phone app records, encrypts
  on the phone, and sends to the paired PC on the home network only, like Immich does for photos.
  It deletes its copy once the PC confirms. Pairing is a QR code scanned once. No cloud.
- The prompt deck names people from the People list by relationship. Children's own questions come
  later, with family access.
- Build order: prompt deck, then reminders, then the desktop inbox and pairing, then the phone app.
- No wearable for now. If one comes later, it keeps only the wearer's own voice.

## The phone link: Echo's first network port (2026-11-14)

- Until now Echo opened no network port. The desktop inbox is the first, as agreed in the memory
  prompts and phone app spec. It listens only while the archive is open and a phone is paired or a
  pairing code is showing, and it answers home-network addresses only.
- No TLS: everything sent is sealed end to end for the paired PC (X25519, HKDF-SHA256,
  AES-256-GCM), and the PC's receipts are HMACs only it can make. The network sees how big each
  recording is and when it was sent, but nothing in it.
- A recording from the phone becomes a story for everyone in the family, titled with its question,
  ready to be written down. The person can change who it is for afterwards.

## Cost map (USD, checked 2026-11-10)

- Lean running cost about $27/month plus Claude usage; premium about $133/month plus Claude usage
- Sub-projects 1 and 2 cost close to nothing to run
- Not found: LiveAvatar custom-avatar add-on price, Anam entry plan price
