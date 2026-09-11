## v1.0.56 — 2026-09-12 `Latest`

### One Library for Automations, Projects and Procedures

The three pages you make things on now live behind **one row in the chat sheet**: **Library**. Open it and **three tabs** sit right under the title — **Automations, Projects, Procedures** — so switching from a schedule to the project it runs in is one tap instead of a trip back through the sheet. Each tab is the page you know, with the same cards, the same editor and the same play, edit and delete on every row. The Library **remembers the tab you left on**, and a notification that names one of the three still opens straight to it. This is **the same Library the desktop app opens**, laid out for a phone.

### Automations Show Cards Only

The Automations tab no longer has a switch between cards and the raw schedule file. On a phone the cards **are** the schedule — every switch, mode and prompt on them writes the same file — so the second view had nothing to add and one more place to go wrong. It is gone, and the header is quieter for it.

### Conversations Moves Into the Sheet

The full **Conversations** page — the one with search and delete — is now **in the chat sheet, right under Customization**, beside the other pages you go to rather than the settings you adjust. Settings is shorter, and the page is **one tap from chat** instead of two.

## v1.0.55 — 2026-09-11

### Automations That Run Several Times a Day

An automation used to fire **once** in whatever period you gave it — once an hour, once a day, once a week, once a month. The editor now opens with **a row of count pills** — **Once, Twice, 3 times, 4 times, 5 times** — above the period chips, and the two read as one sentence: pick **3 times** and **Every day**, in either order, and the schedule fills itself in with **three runs spread evenly across the day**, the first of them minutes from now. A weekly count spreads across **the days of the week**, a monthly one across **the days of the month**, and an hourly one becomes **a clean interval** — every twenty minutes, for three times an hour.

### The Schedule Field Understands Lists

Written by hand, the schedule now takes **a list anywhere it used to take a single value**: **Daily (08:00, 14:00, 20:00)**, **Weekly (Monday, Wednesday, Friday 09:30)**, **Monthly (1, 15 09:00)**. Day names accept **their three-letter short forms**, and a **semicolon** joins whole cron expressions into one schedule. The pills **light from what is actually in the field** — a schedule you typed, or an existing automation you opened to edit — so they describe that automation rather than the last thing you pressed, and **the next-run line underneath** confirms the reading before you save. The schedule guide gains an example of **each new list form**.

## v1.0.54 — 2026-09-11

### Plan First, Change Things After

A new **Plan** switch sits in the chat controls, beside the model and thinking knobs. Turn it on and the turns that follow **only look**: the agent reads, searches and works the problem out, then writes you **a plan to approve** — nothing on your machine is touched while the switch is on. A small **Plan** chip sits in the composer the whole time it is, so the stance is never hidden from the conversation, and one tap on that chip ends it. It is **the same stance the desktop's composer holds**: set it here and the chip over there follows, set it there and this one does, so the two can never disagree about what the next turn is allowed to do.

### Edits and Commands Show Without Turning Anything On

A clean feed used to mean replies and delivered files and nothing else — while the agent edited files and ran commands entirely out of sight. **Every file edit, write and shell run now draws its own compact row**, whatever the tool-activity switch says, because a change in your project is not tool mechanics. The row names the **file or the command**, carries a green **+N** and a red **−M** for an edit or the **exit code** for a run, and how long it took. Tap it open and you get the real thing: the **red-and-green diff with line numbers** for an edit, the output for a command — and, when an output was too large to hold, **where the whole of it was saved**. The switch itself is plainer about all this now: it reads **Show all tool activity**, and says exactly what stays visible when it is off.

### The Task List Ticks Itself Off

When the agent breaks a job into a checklist, that checklist is now **a card in the conversation** — a mark against every item, a red **high** tag where one earned it, and a **done-of-total** count with a progress bar across the top. It **updates in place** instead of reprinting itself: an item moves from waiting to running to done on the card already sitting there, and a list the agent picks back up **several turns later resolves the original card**, where you first saw it, rather than starting a second one.

### Choosing a Model Is One Row

The **Local / Cloud** switch has gone. Providers now sit in **a single row** — **Ollama among them**, listed whenever its daemon is up on your desktop, exactly as a cloud provider is listed once it has a key — and under that row, the models that provider actually has. Picking settles local-versus-cloud **by itself**, which is all that switch was ever doing behind the scenes, so there is one decision where there used to be two.

### The Floating Run Cards Retire

The live cards that floated over whatever screen you were on while an automation, a procedure, the nightly reflection or the daily tidy-up ran are **gone**, and so are their **four switches** on Settings › Channels and Settings › Knowledge. They shipped switched off and were best left that way: a run on a machine you are not looking at should not interrupt the one you are. **Nothing about the runs themselves changes** — same schedules, same notifications — and the **Automations** and **Knowledge** screens still report exactly what ran and when. The one card that stays is the **memory index rebuild**, because that one really does mean your desktop has stopped answering, and a phone left guessing why is worse than a card.

## v1.0.52 — 2026-09-05

### The Thinking Card Is Now Yours to Hide

The **Reasoning** card that opened up last release has **a switch of its own**, on Settings › Channels. It arrives **on**, so nothing changes unless you want it to — and switching it off **hides the card and nothing else**: the model thinks exactly as much as it did before, the thinking is still saved with the conversation, and turning the switch back on brings every past thought back into view. It is **one answer for both screens**, so setting it here settles it for the desktop's chat in the same breath.

### Screenshots the Agent Sizes Itself

Computer use no longer asks you to choose **a screenshot width and format** up front. The agent **picks both for every capture it takes** — sharper when it needs to read fine print on a screen, lighter when it is only finding its way to the next window — so the two rows on Settings › Services have gone, and a line explaining why stands where they were. The **browser extension keeps its own** screenshot settings: those are still yours to set.

## v1.0.51 — 2026-09-04

### Every Tap Answers Back

Press a settings row, an icon button, a project card, a chip in the model picker — anywhere in the app — and **the surface under your finger lights up now**. It never did: the highlight was being asked for in a form the app's styling could not draw, so it was skipped in silence and every one of those presses landed on a control that looked completely inert. **Close to forty controls across the app** get their touch feedback back, from the composer's small buttons to the Automations, Procedures and Projects screens.

### Chips and Bars That Were Never There

A handful of small surfaces had been drawing with **no background at all** — you were seeing their text and nothing else. The **status pill on a task card**, a **tool's status chip**, the **file-type badge** on an attachment, the **download progress track**, the **line numbers and table headers** inside the file viewer and the **bars in the context meter** all carry the tint they were always meant to have again, in both light and dark.

### The Model Chip in the Composer

The name of the model about to answer sat in the composer as **bare coloured text**. It is now **a proper chip** — its own tinted background and a soft outline — and the name has **about a quarter more room** before it is cut short, so a longer model id reads further before it trails off.

## v1.0.50 — 2026-09-02

### Reasoning You Can Read Without Opening

The **Reasoning** card no longer hides the model's thinking behind a tap. It is now an **open scroll block, like a tool's output**: the thinking sits right there under a small brain icon, grows with what it holds up to **eight lines**, and scrolls inside its own box past that — a one-line thought takes one line, and a long deliberation never swallows the conversation. A **copy** button in the card's header puts the whole thinking on your clipboard, and a long press opens the text for selecting any part of it. When a model opens its reasoning with a heading, that **heading becomes the card's title** instead of the plain word "Reasoning". While a reply is still streaming, the block **follows the newest line** as it arrives and stops following the moment you scroll up to read.
