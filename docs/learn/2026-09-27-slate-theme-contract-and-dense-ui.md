---
title: The Slate theme contract, and density as a design choice
date: 2026-09-27
project: ct-formative-assessment
tags: [css, design-systems, theming, slate, accessibility, information-density]
status: unread
---

# The Slate theme contract, and density as a design choice

Think of a paint-by-numbers kit. The picture never says "cadmium red" on it. It says "3", and a card on the side says what 3 is. Swap the card and the whole picture changes colour without anyone touching the canvas. A theme contract is that card, with one improvement: the numbers are replaced by names that say what each patch is for, like "background", "main text" or "the one strong colour".

## What we did in CT Quest

The old stylesheet named colours by what they looked like, or didn't name them at all. There were around 110 distinct colour values written straight into rules. Changing the look meant finding every one of them, and a dark mode meant a second copy of the whole set.

Now the stylesheet opens with one block that defines fourteen names from Slate, Akmal's house framework for educational apps. Seven are neutrals (inks, surfaces and line weights), one is the page background, three are the accent with a deeper shade and a pale wash, and three are fonts. Every rule below that block refers only to those names. Where a rule needs a lighter tint, it mixes two named colours with the CSS colour-mix function instead of writing a new value, so even the tints follow a retint.

Next to the fourteen sit four optional status tones that Slate allows for the state of a thing: positive, neutral, warning and critical. CT Quest uses them for right and wrong answers, late attempts, answers waiting for a teacher's mark and released results. "Not known yet", such as an answer the AI is still marking, is the neutral tone drawn as a hollow dot rather than a fifth colour. Every coloured status also carries a word, so a colour-blind student or teacher loses nothing.

The values are Slate's house palette: a pale parchment background and a muted botanical green accent.

## Why semantic names, and what they cost

The point of naming by purpose is that the names survive a change of mind. Slate hit this early: one project called its accent "gold", which was fine until another project wanted green. A token called gold holding a green value is worse than no token. "Accent" stays true whatever colour it holds. The rule that comes with it is strict: a component may only use contract names, never a raw value. That is what makes a retint one block of edits, and what lets a component copied from one Slate app into another pick up the new app's colours with no changes.

The cost is expressiveness. Fourteen names cannot describe everything. Slate's own records show the pinch: there is no "danger" colour in the contract, so a delete button has nowhere official to get its red. The house answer, in Slate's ADR 0021, is that destructive controls stay local to the app and borrow the critical status tone. CT Quest's Reset and Log out buttons do exactly that, drawn as outlines so a column of them doesn't shout.

The alternative is a large token set, the approach design systems like Material take, with dozens of names such as "on-surface-variant". That covers more cases, but every author has to learn the vocabulary and a small app uses a fraction of it. For apps mostly written by AI agents from a short brief, a small closed set is easier to follow without mistakes.

## Why light only

Supporting dark mode properly means a second palette where every pairing of text and background is checked again for contrast, on every change, forever. Slate checked its light palette with the WCAG contrast formula and published the numbers: body ink is about 14 to 1 against the background, captions about 5 to 1, and the plain accent only about 4 to 1, which is why small green text always uses the deeper shade. Doubling that work only pays if people need the second mode. Slate decided they don't,. The open question for CT Quest is whether students on their own phones, some set to dark, change that answer.

## Density as a design choice

The old layout was built to feel exciting, with rounded cards inside cards, big display type and a banner above every question. On a 1280 by 800 laptop the teacher saw a header, a banner and a form, and no events at all. A student usually had to scroll between the code and the options, which is the one comparison the question asks them to make.

Most of the density here came from fewer layers and less padding that carried no meaning. The base text went from roughly 16 to 15 pixels, card padding to a single 16-pixel level, and corner radii from around 30 to 8. More of the gain came from layout than from shrinking: on a wide screen the question sits beside the answer, and the teacher's page puts the event list beside the results. Grouping comes from thin lines and alignment rather than from nesting boxes. The limit is touch: Parsons buttons stay 44 pixels square on a touch screen, because a student who keeps hitting the wrong button loses more time than the smaller layout saved.

You'd choose the spacious style for a first-run page, marketing, or anything read once. You'd choose density for a tool someone uses every week, where the job is comparing things on one screen.

## Glossary

- **Theme contract:** a fixed list of named colour and font variables that every component must use instead of raw values.
- **Semantic token:** a variable named for its job ("background") rather than its look ("cream").
- **CSS custom property:** a variable in CSS, written with two leading dashes and read with the var function.
- **WCAG (Web Content Accessibility Guidelines):** the standard that sets 4.5 to 1 as the minimum contrast for normal-size text.
- **Status tone:** one of four colours reserved for the state of a thing, always paired with a word.
- **Information density:** how much useful content fits in one view without crowding.
