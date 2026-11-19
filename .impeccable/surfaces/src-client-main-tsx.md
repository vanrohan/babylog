---
version: 1
slug: "src-client-main-tsx"
primary_target: "src/client/main.tsx"
related_targets: ["src/client/style.css","src/client/Details.tsx","src/client/Settings.tsx","src/client/Icon.tsx"]
---

# Diary and Assistant

Use the existing Babylog palette, system fonts, and labeled activity colors.

## Layout

Show the date, daily checks, care counts, records, and Add an entry before the expanded form.
Preserve drafts, exact timestamps, and focus when controls collapse.
Check the rendered phone layout and changed interactions before release.

## Controls

Use compact rows with one label per control.
Keep errors, Offline, and No record states visible.
Put routine help and secondary details behind disclosures.
Use named SVG actions with targets of at least 44px.
Keep phone inputs at 16px and account for the keyboard and safe area.

Daily checks use their selected date. Disable them during loading, saving, or connection loss.
Latest Care uses the latest Feeding and Nappy change starts, regardless of the selected date.
Latest Care displays elapsed time and discloses exact start timestamps.
Navigation shows Assistant when available. Settings retains its Assistant action, account, daily tasks, and Download diary JSON.
Use the shared gear navigation icon.

## Entry form

Closing the form preserves its draft. Successful saves close it. Failed saves retain input.
Keep Start and End in separate labeled sections.
During edits, Start collapses behind Change start time and retains its dated value.
Use date choices, the calendar, hour/minute wheels, shortcuts, and a grouped Relative time panel.
Keep Set separate from Save. Do not add typed time fallbacks.
Still in progress uses an aligned 44px row outside the End frame. Checking it hides that frame.
Undo previews restored fields and automatic sleep changes. Restore states that it discards the draft.

## Assistant

Use the /assistant page with one editable composer for instructions and replies.
Place Send and recording controls beside the composer.
Lock editing during recording and transcription. Keep transcript replacement explicit.
Show proposed changes before confirmation. Preserve proposals after confirmation errors.

See docs/design.md for interface details and docs/architecture.md for data behavior.
