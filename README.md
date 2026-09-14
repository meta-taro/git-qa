# git-qa

**A QA runner where the AI drives and a human signs off.**

[日本語版はこちら / Japanese](./README.ja.md) · [Download](https://meta-taro.github.io/git-qa/)

This is *not* a tool for handing verification to an AI and letting it say
"everything passed." When something ships broken, the person is accountable —
"the AI did it" is not an answer anyone accepts.

So git-qa splits the work:

- **The AI operates** the device, the browser, or the desktop app, following a test sheet
- **The human watches, and places the verdict** with a single keystroke
- **The evidence records who saw what**, and when

## The vocabulary is the point

| Value | Meaning |
|---|---|
| `VERIFIED` | **A person put their name on it** |
| `AUTO_PASS` | The AI passed it. **Nobody looked** |
| `FAIL` | It failed |
| `BLOCKED` | Could not run — a precondition was not met |
| `SKIP` | Not run |

A plain `PASS` would collapse the first two into one value. **That collapse is
exactly what this tool exists to prevent.**

You *can* place `VERIFIED` without looking. **That is a feature, not a hole.**
The moment you press the key, your handle goes into the evidence. It is a
signature, not a lock. There is no anti-cheat machinery — adding it would make a
tool that exists to save effort expensive to use.

## What it can drive

| | |
|---|---|
| **Android devices** | Real devices and emulators over `adb` — tap, swipe, type |
| **Web pages** | Chrome / Edge / Firefox / Safari. Same viewport every run, so you can compare |
| **Desktop apps** | macOS (Accessibility + Vision OCR) and Windows (UI Automation) |
| **From an AI agent** | Over MCP — take a screenshot, read the screen, touch it |

## What evidence looks like

One folder per test run. **Commit the whole folder** if you want the test itself
under version control.

```
<workspace>/
  git-qa.json        marks this folder as one test project
  sheet.tsv          the test sheet
  runs/
    20260914-100000/
      run.json       verdicts, steps, who placed them and when
      case-001/
        screen.webp  the screen at the moment the verdict was placed
        screen.webm  video of the AI operating (watch mode)
```

Nothing about your machine goes into the evidence: paths are relative to the
workspace, so the same run reads the same way on anyone's machine.

## Requirements

- **Node 22 or newer** — required. The app starts a runner process
- `adb` for Android, a browser for web — only if you use them
- `ffmpeg` / `cwebp` — optional. Without them, evidence is kept in the format it
  was captured in, uncompressed

## Install

Download from the [distribution page](https://meta-taro.github.io/git-qa/), or
run it from source:

```bash
git clone https://github.com/meta-taro/git-qa.git
cd git-qa
pnpm install
pnpm app
```

macOS builds are signed and notarized. **Windows builds are not signed** — you
will see "Windows protected your PC"; check the source before choosing *Run*.

## Status

**Beta.** Three products are using it. Rough edges are listed in each release's
notes, and **nothing fails silently** — where a step cannot run, it is recorded
as "a person needs to do this," not as a pass.

Bug reports and requests: [Issues](https://github.com/meta-taro/git-qa/issues).
**Please write them in your own words, right after you hit the problem.**
Summarizing loses the part that actually hurt.

## License

MIT — see [LICENSE](./LICENSE).
