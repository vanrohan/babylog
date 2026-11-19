# Babylog

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Household caregivers record baby care on phones, an iPad, and desktop browsers.
They share one diary and one login. Each device receives a separate session.

## Product Purpose

Record care in one household diary and inspect the recorded patterns.

## Operating Context

The application runs on Prisma Compute with Bun and Postgres.
Household dates and times use Europe/Berlin.

## Capabilities and Constraints

- Record Feeding, Sleep, Nappy change, Bath, notes, and custom activities.
- Store start time, optional end time, pee, poo, temperature, and notes.
- Support Breast, Bottle, Syringe, Cup, Tube, custom feeding subtypes, and an unknown subtype.
- Require Left, Right, or Both for new Breast feeds.
- Support active Feeding and Sleep, edits, deletion, and Undo for manual edits.
- Share daily tasks with add, rename, removal, and dated checks.
- Show care patterns in Day, Week, Month, and custom ranges.
- Preserve drafts during failed saves, form closing, and navigation.
- Keep manual entry available when Assistant fails.
- Require human confirmation before every Assistant change.
- Show recorded care without medical advice, predictions, or inferred missing care.

Latest Care shows elapsed time since Feeding and Nappy starts.
Daily task defaults are Vitamin D, Tummy time, and Face wash.
Elapsed times use the latest past start, independent of the selected diary date.
Exact start timestamps remain available in a disclosure.
Assistant supports typed instructions and recording through OpenRouter.

## Brand Commitments

Use the Babylog name, system fonts, white surfaces, and violet accent.
Use short English labels and compact grouped controls.

## Interface

Keep one label per control and one value per summary.
Put routine help and secondary details behind a tap.
Use named SVG icon controls with targets of at least 44px.
Use date choices, a calendar, and wheels for entry times.
Keep Set separate from Save.
See [interface behavior](docs/design.md) and [technical rules](docs/architecture.md).
