# Echo — design spec for the assistant door ("Jarvis door")

**Status:** Waiting for Marc's "merge 29". No code exists for this.
**Covers:** a way for Marc's own AI assistant, Jarvis, running on the same PC, to read his words in
Echo, put things in for him to approve, and talk to his echo.
**Does not cover:** access from another machine or the internet; family access (sub-project 4).

**Reading note:** Echo is for anyone. Wherever this says "Marc" read "the person creating their echo",
and wherever it says "Jarvis" read "that person's own AI assistant".

---

## 1. What Marc asked for (2026-11-13)

| Question | Marc's answer |
|---|---|
| What may Jarvis do? | Read my words. Put things in for me. Talk to my echo. |
| Where does Jarvis run? | On this same PC. |
| When may Jarvis get in? | **Any time, on its own** (not only while Echo is open). |
| What happens to what Jarvis puts in? | It waits for me to approve. |
| Who does Jarvis talk to the echo as? | As itself: "Jarvis, my assistant". |
| How does Jarvis use tools? | Both MCP servers and shell commands. |

## 2. The one hard part, and how this design answers it

"Any time, on its own" means something on the PC must be able to read Marc's words while Echo is
closed and locked. The simple way is to give Jarvis the key to the whole archive. **This design does
not do that.**

Jarvis runs commands on the PC as Marc. So anything Jarvis can reach, a Jarvis that has been misled
(for example by an instruction hidden in a web page or an email it reads) can copy out. If the whole
archive's key were within its reach, that would be everything: the consent video, face and voice,
words marked for one person only, and other people's messages.

So instead Echo keeps a **second, smaller store just for Jarvis**, with its own key:

```
                 Echo (open, unlocked by Marc)
                          │ writes, every time something changes and on lock
                          ▼
   ┌──────────── Jarvis's store (its own key) ────────────┐
   │ IN IT                          │ NEVER IN IT          │
   │ Marc's words marked "everyone" │ the archive's key    │
   │ character sheet, style profile │ the passphrase       │
   │ the AI key (to run the echo)   │ other people's words │
   │ fingerprints of other people's │ words for one person │
   │   8-word runs (not the words)  │ face, voice, consent │
   └───────────────────────────────────────────────────────┘
                          ▲ reads any time        │ writes any time
                          │                       ▼
                    the door (CLI + MCP)     tray + Jarvis's conversations
                          ▲                       │
                          │                       ▼ picked up next time Marc opens Echo
                       Jarvis                 "From Jarvis" tray: approve or throw away
```

- The worst a misled Jarvis can copy out is what is in that store. That is decided by what Echo
  puts there, not by what the door's code allows.
- Nothing is stale in practice: Marc's words only change inside Echo, and Echo rewrites the store
  as they change.
- The cost is more to build than "give Jarvis the key": five pull requests instead of two.

**What this does not fix, said plainly:** the store's key has to sit on the PC where Jarvis can use
it unattended. So anything that runs as Marc on this PC, and anyone who takes the disk out of it,
can read what is in the store. Rule 5 ("everything is encrypted at rest") holds for the archive; for
the store it holds only as far as Marc's Windows account and disk are protected. Turning on Windows
device encryption (BitLocker) closes the stolen-disk half. The door is off until Marc turns it on.

## 3. The six rules, checked against this

| Rule | How the door keeps it |
|---|---|
| 1. Only the person creates their clone | Jarvis cannot add anything. It can only leave things in a tray. Nothing reaches the echo until Marc has read it in Echo and said it is his. |
| 2. Presented as an AI echo | The same fixed opening line, set by the app, starts every conversation Jarvis has. |
| 3. Answers from captured material | The same engine and the same checker as the Talk screen. |
| 4. Named family only, no public link | **Marc is making an exception for his own assistant.** Jarvis is one named listener, marked as an AI assistant and not family. No network port is opened: the door is a program on this PC. |
| 5. Encrypted, exportable, deletable | The store is encrypted under its own key (see the limit in section 2). "Delete everything" and turning the door off both wipe the store and its key. The export includes Jarvis's conversations. |
| 6. Never quote other people's messages | Other people's words are never in the store. The check that throws away a reply repeating eight of their words in a row works from fingerprints (hashes) of those runs. |

## 4. What Jarvis can do

All of these work whether Echo is open or closed, as long as the door is switched on.

| Jarvis asks | What it gets |
|---|---|
| status | Whether the door is on, when the store was last written, how many passages it holds. |
| search / read | Marc's own words marked "everyone", as passages with where each came from (story, interview, advice, message, letter), plus the character sheet and style profile. |
| suggest a file | Leaves a note in the tray: "import this file" with its path. Marc sees it in Echo and it goes through the normal import preview. |
| suggest words | Leaves a draft in the tray. Marc reads it, corrects it, and saves it as a story of his own, or throws it away. A saved one is marked as drafted by Jarvis. |
| ask the echo | Talks to the echo as "Jarvis, my assistant". The conversation is kept and Marc can read it in Echo. |

What Jarvis cannot do, because the door has no command for it and the store does not hold it: read
other people's messages, read anything marked for one person, see or hear recordings, change or
delete anything, approve its own suggestions, read or change the consent, turn the door on.

## 5. What Marc sees in Echo

- **Setup, "Your assistant's door":** off by default. Turning it on shows exactly what will be put
  in the store, and the limit from section 2 in plain words. Turning it off wipes the store and key.
- **Home, "From Jarvis" tray:** only when something is waiting. Each item: what it is, when Jarvis
  left it, approve (which opens the normal import or story screen) or throw away.
- **Talk:** Jarvis appears in the list of people, marked as an assistant. Its conversations can be
  read there. Marc cannot type into them.
- **Activity log:** every read, suggestion and question from Jarvis, with the time. No words.

## 6. Plumbing (mine to choose; one line each on why)

- **One small program, `echo-door`, installed with Echo**, that works as shell commands (JSON out)
  and as an MCP server over standard input and output. One door, two ways to knock, because Marc
  said Jarvis uses both.
- **No network port.** Jarvis starts the program itself. Nothing listens.
- **It runs on the copy of Node that is inside Echo**, so nothing else needs installing. Whether
  the installed Echo allows that is proven in the first door PR, on the installed app.
- **The MCP side is written by hand** (it is a small, fixed set of messages), so the door adds no
  new dependency to audit.
- **The store is one sealed file plus a tray folder**, kept in Echo's settings folder, not inside
  the archive, so it is there when the archive is locked. Its key is a separate random key.
- **Jarvis's questions to the echo spend Marc's AI key.** A daily limit stops a runaway loop.

## 7. Build order

Each is one pull request, checked on the installed app, merged on Marc's word.

| PR | What it adds | Marc's click-through |
|---|---|---|
| A | The store, its key, the Setup switch, wipe on off and on delete-everything | Turn the door on; see what Echo says it will share; turn it off |
| B | `echo-door` shell commands: status, search, read | In PowerShell, run `echo-door status` and `echo-door search` with Echo closed |
| C | The same as an MCP server | Add it to Jarvis; ask Jarvis what Echo knows about something |
| D | Suggest a file, suggest words, the "From Jarvis" tray | Have Jarvis suggest something; approve one, throw one away |
| E | Ask the echo, Jarvis as a listener, conversations shown in Talk, daily limit | Have Jarvis ask the echo a question with Echo closed; read it in Talk |

## 8. Open points for Marc (my recommendation first; none blocks "merge 29")

1. **Daily limit on Jarvis's questions to the echo.** Recommend 30 a day. Marc sets the number.
2. **Words marked for one person only.** Recommend Jarvis never sees them. (Built that way unless
   Marc says otherwise.)
3. **After Marc's death.** Recommend the door is switched off when the heir takes over, and the
   heir decides whether to turn it on. That is sub-project 4; nothing is built for it here.
4. **Windows device encryption.** Recommend turning it on before turning the door on. Echo cannot
   do that for him.
