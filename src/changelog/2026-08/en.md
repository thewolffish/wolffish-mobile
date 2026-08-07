## v1.0.21 — 2026-08-07 `Latest`

### PDFs, Read Where They Sit

A PDF in a conversation used to be a file row on Android — tap it and the document left for whatever viewer the phone happened to have. It now **opens in the card itself**, showing a real first page and expanding to the whole document, scrollable and pinch-zoomable, exactly as it already did on iPhone. The reader travels with the app rather than depending on one being installed, and the document is read where it sits: nothing is handed to another app, and the page drawing it can reach no file but the one you opened. Very large PDFs still go to the system viewer, which is where they belong.

### A Tap That Lands Where It Says

Tapping a notification now **opens the thing the notification is about** — the conversation that just finished, the schedule that ran, the screen that needs you — including when that tap is what launched the app. It used to open Wolffish and stop there, because the app was already on its way somewhere else by the time the tap was read. A conversation reached this way **waits for the desktop** rather than flashing an empty new chat and correcting itself a second later, and the back arrow on a screen opened straight from a notification now leads into the app instead of doing nothing. A link Wolffish cannot place leaves you exactly where you are — and the desktop, for its part, can no longer point a notification at a screen this app does not have.

### Smaller Things

The composer's controls button **has its own glyph** now — vertical faders, for the sheet that holds mode, thinking, model and the context meter — so it no longer reads as a second copy of the conversations navigator sitting next to it. And entering demo mode **keeps its progress bar** until the chat is actually on screen, instead of dropping it for a few frames right before the app moved anyway.

## v1.0.20 — 2026-08-07

### Six Ranges, Six Answers

The Usage screen's time ranges now each **report their own window**. Every total is closed at today as well as opened at its start, so a figure labelled Today can never quietly carry tomorrow, and stepping from 3 Months to 6 Months to Year to Date moves the numbers instead of repeating them. The switch itself now **fills its row** as a single control, splitting the width evenly between the six rather than trailing off into empty space, and it sits in the same card the rest of the screen is built from.

### The Sheet Keeps Its Destinations

Settings, Projects, Automations, Procedures and Customization now **stay put at the top of the conversations sheet** while the conversations scroll underneath them. They are the five places the sheet exists to reach, and a destination that scrolls away with the list is one you have to scroll back up to find.

### More to See Before You Pair

Demo mode gains three conversations that show the parts of Wolffish the earlier set never reached: an agent **asking permission** before it does something dangerous — and being refused once — a **twenty-question card** answered one chip at a time, and a whole session **held by voice**, spoken in both directions. The workspace behind the demo is populated too, so Projects, Procedures, Automations and the customization documents carry real content from the first screen rather than filling in a moment later.

### Smaller Things

The Model screen now leads with **how the model behaves** — chat mode and thinking — and keeps the picker below them, since those are the two knobs touched every session; the section holding them is called **Model** rather than Brain. The settings list's **Data** row shows two figures where it showed one: the desktop's workspace beside what this phone is actually holding. And a diagnostic bundle's download **counts from 0 KB rather than from nothing**, both sides in the same unit, so the first seconds of a transfer read as progress rather than a stall.

## v1.0.19 — 2026-08-06

### The Workspace, Editable

Projects, procedures and automations were things the phone could show and only the desktop could change. All three are now **edited from either screen**. A **project** gathers the instructions and files that fresh conversations start from, and a chat opened inside one carries them from its very first turn rather than picking them up a moment later. A **procedure** is a saved prompt you run on demand. An **automation** is a prompt that runs on a schedule, edited here as the same markdown file the desktop's own editor writes, with the time of its next run and a play button that reports what the scheduler actually did. Every one of these writes goes through the desktop's own code, so a change made on the phone and a change made at the machine are the same act — and both screens show it at once.

### The Three Documents Behind Every Answer

**Soul**, **User** and **Agents** — who Wolffish is, what it should always know about you, and the procedures of yours that outrank the built-in ones — now open as editors on the phone and save **straight into the desktop workspace**. These are the files that shape every reply on every surface, chat and Telegram and WhatsApp alike, and until now the only way to touch them was to be sitting at the machine.

### Turns You Can Score

Every finished answer carries a **rating bar**. A score cast here lands on the desktop exactly as the desktop's own does, and a score cast anywhere else — the desktop's bar, a bare number replied to Telegram — appears here without waiting for anything to reload. It is the same signal the agent already learns from; it simply stopped requiring the desktop.

### Every Conversation, Without Leaving the One You're In

A sheet slides over the chat carrying the **whole conversation list**, grouped by recency, showing which project each one belongs to and which one is running right now. Switching is a tap, and the turn you were watching keeps streaming while you look.

### What the Desktop Is Busy With

Automations, compaction, the nightly reflection and a memory index being rebuilt now surface as **cards over whatever screen you are on**, with the prompt behind each one a tap away. They appear the moment the phone connects — including for a run that started while it was asleep — and they go when the connection goes, because a card claiming something is running on a machine the phone can no longer see is a card that lies.

### Diagnostics From the Phone

Collecting a conversation's diagnostic bundle — logs, tasks, memory, context, settings, attachments, and the model's own account of what went wrong — is now something the phone can start, **watch step by step**, and hand to the share sheet when it finishes. It runs behind the same single-flight guard as the desktop's own button, so a run started here and one started there can never fight over the same files.

### Smaller Things

Pictures now **pinch to zoom and pan** rather than opening at one fixed size. Conversation lists show **where each one came from** — Telegram, WhatsApp, the phone, an automation — as a single glyph, the same one the desktop draws. Projects get an **emoji picker** for their icon, and the composer's queue reads more plainly than it did.
