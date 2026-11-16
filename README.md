# Echo

Capture yourself while you are alive, so your family can keep talking to an AI echo of you afterwards.

Echo is a Windows desktop app. Everything you capture stays on your own computer. You bring your own
Claude API key and your own storage.

Echo is free and open source under the [GNU AGPL v3](LICENSE).

## Install Echo (Windows)

1. Download `Echo-Setup-<version>.exe` from the newest release on this repository's Releases page.
2. Run it. **Windows will warn that it does not recognise the app**, because the installer is not
   signed: choose "More info", then "Run anyway".
3. Echo installs for your Windows account only, with no administrator needed, and puts "Echo" in
   the Start menu and on the desktop.

Uninstalling Echo (Windows Settings, Apps) removes the program and nothing else. Your archive is a
folder you chose, outside the program, and it is left exactly as it is.

To publish a new installer: run the "Release" workflow by hand from the Actions tab. It builds the
installer from `main` and attaches it to a release named for the version in `package.json`.

## Open the app from the source (for checking a pull request)

You need [Node.js](https://nodejs.org) 22.18 or newer and Git. From this folder, in PowerShell:

```powershell
.\run.ps1 main
```

To check a pull request before it is merged, give its number:

```powershell
.\run.ps1 7
```

If Windows refuses to run the script:

```powershell
powershell -ExecutionPolicy Bypass -File .\run.ps1 main
```

## Documents

- [`docs/spec-1-2-capture-and-persona.md`](docs/spec-1-2-capture-and-persona.md) — the approved design
- [`docs/plan-1-2-build-order.md`](docs/plan-1-2-build-order.md) — the build order, 22 steps
- [`docs/decisions.md`](docs/decisions.md) — every decision made so far
- [`docs/dependencies-and-device.md`](docs/dependencies-and-device.md) — what Echo depends on, and the device it needs

## The rules Echo is built around

- Only you can create your echo, and you record your consent first.
- It is always presented as an AI echo, never as you being alive.
- It answers from what you captured. When it has nothing, it says so.
- Only named family members can talk to it.
- Everything is encrypted, exportable, and your heir can pause or delete it.
- It never repeats other people's private messages.
