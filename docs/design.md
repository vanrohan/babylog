# Interface

## Visual system

Use system rounded fonts for headings and system sans fonts for controls.
The canvas is #f7f7fb, surfaces are white, and text is #263044.
The violet accent is #5c62bb. Colors distinguish activities without implying medical status.
Keep labels, marker shapes, and text alternatives alongside colors.

Use compact grouped controls with one label and one value.
Put routine help, exact timestamps, and secondary details behind a tap.
Show errors, Offline, and No record directly.
Use shared SVG icons with specific accessible names and targets of at least 44px.
Editable phone text uses at least 16px.

## Time log

Show Latest Care above the selected diary date.
Latest Care uses the latest past Feeding and Nappy starts, independent of the selected date.
Show elapsed time since each start. A disclosure shows its exact timestamp.
Keep the last loaded care records visible during connection loss and show Offline.
Show No record when no past start exists. Do not make these displays settings controls.

Center the selected date between equal arrow controls. Show Today or Yesterday below the date when applicable.
Use Go to today to return to the current household date.
Keep the exact date in the daily checks' accessible name.
Daily checks wrap beside desktop date controls and stack below them on phones.
Disable checks during loading, saving, and connection failure.
Never show the previous date's values while another date loads.
A failed save restores the prior value. A stale conflict refreshes the server value.

The entry form starts closed. Editing opens it and moves focus to its heading.
Closing the form or navigating retains its complete draft.
A successful save closes the form. A failed save keeps its values and error.
Show record times directly below their titles.
Show short notes directly. Expand long notes and source details without changing stored text.

Settings contains the account, available Assistant action, daily tasks, and Download diary JSON.
Downloads keep Babylog open and preserve entry drafts.
Use the shared gear icon for the Settings navigation action.

## Entry controls

Feeding has one activity button and a subtype selector.
New forms start with Breast and require a side.
Save shows persistent errors beside missing fields and in the footer.
The form moves focus to the first invalid field. Correction or field removal clears its error.
Invalid saves preserve the complete draft and send no write.
Other opens a custom subtype field. Not recorded preserves an unknown subtype.
Temperature accepts a decimal point or comma. Blank means no temperature.
Custom activity and subtype names cannot contain only spaces.

Start and End have separate labels and borders.
Start collapses during edits but keeps its dated value visible. End stays open when the record is complete.
Today, Yesterday, and the calendar select dates.
Hour and minute wheels support touch, mouse, scrolling, and keyboard selection.
Clock wheels wrap without changing the date or the other unit.
Save reads the visible wheel position before submitting.
There are no typed time or typed Minutes controls.

Still in progress uses a compact row aligned with the form controls for Feeding and Sleep.
Its complete label provides a 44px target outside the End frame.
Checked means active and hides the complete End frame.
Clearing it reveals End controls. Clearing End restores the checkbox and its focus.
Other activities retain optional End controls without this checkbox.

Start shortcuts offer Now, 15min ago, and Last end.
Last end uses the latest past endpoint and excludes the edited record.
End shortcuts offer Now, 10min ago, 15min ago, 10min total, and 15min total.
Ago shortcuts calculate from the time of the tap.
Duration shortcuts calculate from Start and replace End.
Relative time is next to the calendar, or next to Add end time when End is empty.
The relative controls replace the clock wheels while open.
They group the mode, presets, Minutes wheel, dated preview, and Set action.
The Minutes wheel ranges from 0 through 120.
Only one helper opens at a time. Manual time changes close it.
Set changes one draft field, closes the relative controls, and returns focus to Relative time.
Save submits the draft.

Save stays in the form footer with keyboard and safe-area clearance.
Long actions show a small spinner on the active button and expose aria-busy.
The spinner replaces an existing icon when possible. Reduced motion keeps the indicator still.
Save, Delete, Restore, End, tasks, exports, account actions, and Assistant actions show their own pending state.
Conflicting actions stay disabled until the request finishes. Save retains one busy state during its automatic retry.
A temporary save failure receives one safe automatic retry. Failed retries retain the draft for manual retry.
Changed values under an already completed save show an error and direct the caregiver to the diary.
Delete stays outside that footer and requires confirmation.
Undo previews all reversed fields and automatic sleep changes before Restore.
Restore discards the current unsaved draft. Keep it separate from Save.

## Assistant

Open Assistant from navigation or Settings when the server reports availability.
Phone navigation wraps when labels need more space. Closing Assistant returns focus to its launch control.
Availability refreshes after sign-in, on focus, and every ten seconds while visible.
Failed or malformed checks retain known availability. Request timeouts permit later recovery.
Assistant uses a page with normal scrolling, a conversation log, and one instruction or reply composer.
The textbox accepts typing immediately. It grows to half the viewport height, then scrolls internally.
Send and microphone controls stay outside the textbox.
A pending instruction appears once. A failed request restores its exact draft and preserves earlier turns.
New replies or proposals scroll into view without taking focus from the caregiver.

Recording starts only after an explicit action.
Recording and transcription lock editing and Send.
Show elapsed time, signal state, Stop, transcription progress, playback, and explicit retry when applicable.
A transcript cannot silently replace typed text.
Navigation stops capture and cancels pending transcription.

Keep proposal confirmation separate from Send.
A failed confirmation retains the proposal. A successful confirmation identifies the saved result.
View day opens the affected date when the result identifies one date.
A failed refresh must not turn a confirmed save into a failed-save message.

## Dashboard

Week opens by default and starts on Monday. Month uses the calendar month.
Custom ranges include both dates and allow up to 366 days.
Opening Day retains the previous range for Back to range.
Keep filters and selected dates during polling.

Sections appear in this order: Daily rhythm, Left vs right, When activities start, and Continuous timeline.
Left vs right appears only for All activities or Feeding.
Keep exact entry details and Edit in time log available from charts and text records.
A complete daily row opens Day. Small markers do not require precise selection.
Dates and daily pee and poo counts remain visible during phone timeline scrolling.

Activity filters change timelines, start density, and the breast balance section.
Range totals include every activity.
Other activities remain in timelines and records but do not enter density curves or their sample notices.
Start density shows recorded timing, not duration or expected care.
Smoothing offers 30 minutes, one hour, and two hours.
Each activity curve totals 100 percent and wraps across midnight.
Show sample counts and a notice for fewer than five starts.

Continuous timeline uses native horizontal scrolling across adjacent days and midnight.
Earlier and Later retain part of the visible timeline.
Scrolling changes the viewport, not the selected range or totals.
Polling and activity filters preserve its position.

## Accessibility and device checks

Keep visible keyboard focus and text alternatives for charts.
Use native checkboxes, named listboxes, and dated groups.
Restore focus when controls disappear or dialogs close.
Respect reduced motion. Keep controls reachable with the software keyboard open.
Browser emulation does not verify physical Safari gestures, microphone behavior, or VoiceOver.
Check those behaviors on an iPhone and iPad before claiming device support for a changed interaction.

## Test Case Review

| Area | Cases |
| --- | --- |
| Validation | Missing sides, empty or whitespace names, side and temperature errors, field focus, and correction without writes. |
| Save retries | Same key across failures, closing, and navigation; a new key after success; changed payload conflicts. |
| Undo | Failed receipt storage preserves the entry version and prior Undo receipt. |
| Pending actions | One active spinner, disabled conflicting actions, and visible errors after failure. |
| End | Retries preserve the key, payload, timestamp, version, and Undo receipt. |
| Time picker | Check shortcut offsets at midnight, focus after Set, and calendar placement with a custom date at 320px. |
| Relative time | Check both hidden clock wheels, an empty optional End, and Save with an unapplied relative choice. |
| Availability | Failed or malformed checks, timeouts, late session responses, navigation, retained drafts, and enlarged labels. |
| Recording | Invalid WAV chunks, cancellation, provider failure, and legacy URLs without provider authorization. |

Tests check control names, descriptions, focus, and draft values in Chrome and WebKit.
Physical Safari, VoiceOver, and microphone checks remain separate.
