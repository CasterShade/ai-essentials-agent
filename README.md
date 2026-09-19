# Agent embed middle layer (YU Global)

One URL that every course embeds. The **key** in the URL is looked up in
`registry.json`, which decides the provider (ElevenLabs, GPT-Trainer, or any hosted
page) and the agent behind it. Change the registry, every course follows. Nothing
provider-specific ever goes into a course.

Live: `https://castershade.github.io/ai-essentials-agent/`
Snippet builder for IDs: `https://castershade.github.io/ai-essentials-agent/builder.html`

## Embed contract (what goes into a course)

In a lesson block (Rise, Canvas, SCORM):

```html
<iframe src="https://castershade.github.io/ai-essentials-agent/?agent=ai-essentials-hs"
        allow="microphone; clipboard-write" width="100%" height="600" style="border:0"></iframe>
```

Floating bubble on a whole site (Thinkific *Site footer code*):

```html
<script src="https://castershade.github.io/ai-essentials-agent/loader.js"
        data-agent="tutorbot-onla" data-course-id="MAR 2501" data-course-name="Buyer Behavior" async></script>
```

| URL / data- param | Meaning |
|---|---|
| `agent` | registry key or alias. Omit = `registry.default` (today: the HS agent, so the old embed URL keeps working unchanged). |
| `mode` | `full` (fills the block) or `bubble` (provider's own floating launcher). Default = the entry's `mode`. |
| `course_id`, `course_name`, `module`, `lang`, `user` | context passed to the agent as variables, merged over the entry's `variables` defaults. |
| `module` (again) | also picks a **lesson context** from the entry's `contexts` map -- see "One agent, many pages" below. Unknown or missing = the `default` context. |
| `stage=0` | hide the activity bar on this embed (the context is still sent to the agent). |
| `debug=1` | prints the resolved config in an overlay. Use it when an ID says "it shows the wrong bot". |

Resolution: key -> alias -> `redirect` chain (max 5) -> must be `active` -> otherwise
`registry.fallback` **with a visible notice**. If `registry.json` itself cannot be fetched, a
baked-in copy of the default agent is used. A course never shows a blank block.

## One agent, many pages (lesson contexts)

A course uses ONE agent. What changes per page is the **context**: `?agent=ai-essentials-hs&module=types-of-ai`
looks up `agents.ai-essentials-hs.contexts["types-of-ai"]` and

1. sends `lesson`, `activity`, `opener` and `steps` to the agent as dynamic variables (the agent's system prompt
   references `{{lesson}}` / `{{activity}}` / `{{steps}}`, its first message is `{{opener}}`), and
2. draws a thin **activity bar** above the widget: the activity title, step dots, and a drawer with the steps.

To change what the agent knows or says on a page, edit that context in `registry.json`. The course is not touched.
The builder lists the contexts in a dropdown and shows exactly what the agent is told.

**Client tools (on-screen helpers).** `clientTools` on the entry switches on up to four helpers that the agent can
call while it talks: `show_card` (pin a note the student can copy), `mark_step` (tick a step), `celebrate`
(confetti, at most once a minute) and `open_resource` (offer a button for a link from the entry's `resources`
allowlist -- the agent cannot put any other URL on screen). Everything the model sends is rendered as plain text and
length-capped. The same four tools must be defined on the ElevenLabs agent (type `client`, same names); until they
are, nothing calls them, so shipping this side first is safe. The tools live inside our iframe: a cross-origin frame
cannot touch the Rise page around it, by design.

**Order of operations when the agent prompt starts using `{{lesson}}` etc.:** publish this repo FIRST, wait ~10
minutes, THEN update the agent. An old cached shell that sends no `lesson` to a prompt that requires it fails the
conversation. Also set the same defaults as *dynamic variable placeholders* on the agent as a second net.

## Cohort Hub door (`hub.html` + `hubs.json`)

Courses embed `hub.html?hub=chah-2026&space=question-box` -- never the hub's real address. `hubs.json` decides:
`pending` = a friendly placeholder (safe to ship in a course before the hub exists), `active` = the block is sent to
`<baseUrl>/embed?cohort=..&course=..&space=..` (or to `<baseUrl>/?cohort=..` when the link is opened in its own tab),
`paused` = a short "back soon" note. When the hub gets its URL, or moves from one host to another:

```powershell
.\scripts\set-hub-url.ps1 -Url https://cohort-hub.<id>.eastus.azurecontainerapps.io   # checks /healthz + frame-ancestors
.\publish.ps1
```

(`node scripts/set-hub-url.mjs <url>` does the same.) Every Cohort Hub block in every course follows within ~10
minutes. The hub's `FRAME_ANCESTORS` must allow the host that serves the Rise lesson (check it once in DevTools).

## Runbook: the three edits you will actually make

1. **Point a course at a different agent** (same provider or not): change that key's
   `provider` + `agentId`/`botUuid`. Nothing else.
2. **Retire a key without touching courses:** set `"status": "retired", "redirect": "new-key"`.
   Old embeds resolve to the new key. Aliases work the same way for renames.
3. **A provider widget release breaks something:** pin the script in `providers.elevenlabs.scriptUrl`
   (e.g. `https://unpkg.com/@elevenlabs/convai-widget-embed@0.18.2`) -- one line, every course.

Every push to `main` runs `scripts/validate-registry.mjs` (schema, unique aliases, redirect
targets exist and terminate, default/fallback active) and `scripts/smoke.mjs` (real Chromium,
46 checks) **before** GitHub Pages deploys. A broken registry cannot reach the courses.

Adding an agent = add an object under `agents` (see `registry.schema.json`), commit, wait ~10 min.

## Constraints you are managing (read before a live session)

- **Propagation is ~10 minutes.** GitHub Pages serves `cache-control: max-age=600`. Do not edit the
  registry five minutes before a class and expect it to be live.
- **ElevenLabs concurrency is per plan, not per agent:** Free 4, Starter 6, Creator 10, Pro 20,
  Scale 30, Business 40 simultaneous conversations (pricing page, Sept 2026). The 21st student in a
  20-seat live kickoff on a Pro plan gets an error. Either stagger the "say hello to the assistant"
  moment in pairs, or enable *burst pricing* on the agent (up to 3x at double rate), or upgrade.
  Check the plan **before** Sept 29.
- **ElevenLabs overrides are off by default.** `override-language` / `override-first-message` only
  work if *Overrides* are enabled in the agent's Security tab; sending them otherwise fails the
  conversation. Hence `overrides: {language: false}` per entry -- flip it only after enabling it in
  ElevenLabs.
- **Dynamic variables must be complete.** If the agent prompt references `{{course_name}}` and the
  variable is missing, the conversation fails. Each entry's `variables` block is the guaranteed
  default set; URL params only override.
- **Microphone in an iframe** needs `allow="microphone"` on the *outer* iframe (the one in the course).
  The builder always emits it. Without it the widget looks fine and silently cannot hear.
- **Public agents only.** The widget needs the agent set to public with auth disabled; lock it to
  hosts in the agent's Security tab (allowlist `castershade.github.io` plus the LMS domains).
- **GPT-Trainer variables** (`course_id`, `course_name`) must exist under *Customizations > User Data
  Collection* on the bot, and the bot must actually contain that course's sources. The iframe
  handshake (`gpt_chatbot_state` -> `gpt_initial_messages_variables`) is the dashboard-generated
  method, not a documented API -- it is isolated in one adapter so a change there is a one-file fix.
- **The full-block fill for ElevenLabs** relies on their internal `.overlay/.sheet` class names. If
  a release renames them, the widget still works, it just floats at its default size.
- **GitHub Pages limits:** 100 GB/month soft bandwidth, 10 builds/hour, non-commercial use. This
  page is ~10 KB and the widgets load from the providers' CDNs, so bandwidth is not a concern.
- **Static = no server, no state, no scaling problem on our side.** Parallel users hit GitHub's CDN
  for the shell and the provider for the conversation; the only concurrency limit is the provider's.

## Files

| File | Role |
|---|---|
| `index.html` | the shell every course embeds |
| `embed.js` | resolver + provider adapters (`elevenlabs`, `gpt-trainer`, `url`) |
| `loader.js` | host-page bubble (our button + our iframe; provider-independent) |
| `registry.json` | the lookup table -- the only file you normally edit (agents, lesson contexts, approved links) |
| `hub.html`, `hub.js`, `hubs.json` | the Cohort Hub door: placeholder until the hub is hosted, then a redirect |
| `scripts/set-hub-url.ps1` / `.mjs` | set or move the hub URL (the "replace script") |
| `registry.schema.json` | schema for the registry |
| `builder.html` | snippet builder + live preview + registry table (for IDs) |
| `scripts/validate-registry.mjs` | CI gate, zero dependencies |
| `scripts/smoke.mjs` | CI browser test (Playwright, external network blocked) |
| `.github/workflows/deploy.yml` | validate -> smoke -> deploy to Pages |

Local check: `node scripts/validate-registry.mjs && npm i --no-save playwright && npx playwright install chromium && node scripts/smoke.mjs`
