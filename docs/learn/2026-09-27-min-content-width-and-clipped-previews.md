---
title: Why a wide child can break a narrow column (min-width auto and fieldsets)
date: 2026-09-27
project: ct-formative-assessment
tags: [css, layout, flexbox, grid, debugging, headless-chrome]
status: unread
---

# Why a wide child can break a narrow column

Picture a bookshelf with a fixed width, and a box that refuses to be narrower than the longest thing inside it. Put a long rolled-up poster in the box and the box pokes out past the end of the shelf, whatever the shelf's width says. In CSS the shelf is a column of the page, the box is a flex or grid item, and the poster is a line of code that must not wrap.

## What happened in this project

The teacher's compact question preview lists every question in a selection, and each row expands to show the question's code, its options with the right one marked, and for block questions the hidden grids and the reference solution. On the results view it sits in the wide right-hand column and looked fine. After the merge it also appeared under the quick setup cards, in the narrow left-hand "New event" column, and there the expanded rows ran about a hundred pixels past the card's right edge. The card has overflow hidden, so the extra width was simply cut off: the "Correct" tag was half gone and the ends of options were missing.

No element in the page was wider than the window, so a simple "is the page scrolling sideways?" check passed. Walking up from the preview list in headless Chrome, printing each ancestor's width and computed min-width, found two culprits. The first was the fieldset that wraps the quick setup cards. The second was the summary line inside it, which is a grid item. Both were taking their minimum width from their content, and their content included lines of code that are set never to wrap.

## How the mechanism works

Flex items and grid items have a default minimum width of "auto". For them, auto does not mean zero. It means "no narrower than my content's minimum width", the min-content size, and for a block of preformatted code that is the length of its longest line. A flex or grid container can shrink its items only down to that floor, so one long line of code sets the width of every ancestor that is a flex or grid item, all the way up to the first one that has an explicit min-width of zero or its own overflow scroll.

A fieldset behaves the same way on its own. Browsers give fieldsets a default min-width of min-content, a leftover from the days when forms were laid out as tables, so a fieldset will grow to fit its widest descendant even outside flex or grid.

The fix is to lift the floor where the chain breaks: min-width zero on the fieldset and on the grid's children. Once they can shrink, the code blocks further down, which already have overflow set to auto, get a width they have to live within, and they scroll sideways inside themselves instead of pushing the whole column out. The preview list already had min-width zero on its list items for exactly this reason, from the branch that built it; it only needed repeating on the containers that the new location added.

A second problem in the same view was unrelated but looked similar: the preview reused the page's shared code-box style, which caps height at five and a half rem so short snippets elsewhere stay compact. In the preview that cut every program after four lines. A more specific rule removes the cap inside the preview only.

## Why fix it this way, and the alternatives

Setting min-width zero is the standard fix and changes nothing visible when content already fits. The alternatives each cost something. Setting overflow hidden on the column hides the symptom, which is exactly what the card was already doing and why the bug looked like missing text rather than a layout error. Letting code wrap would make indentation-sensitive Python and the block program listings misleading. Giving the column a larger fixed width only moves the threshold: the next long line breaks it again.

The signal to reach for this fix is any time content inside a flex row, a grid, or a fieldset is wider than you expect and nothing in the element itself asks for that width. The quickest diagnosis is to walk the ancestors of the overflowing element and look for the first one whose min-width is auto (or min-content) and whose width is larger than its parent's.

## Glossary

- **min-content:** the narrowest an element can be without overflowing its own content; for text that never wraps, the length of its longest line.
- **Flex item / grid item:** a direct child of an element laid out with display flex or grid; these get the "auto" minimum width described above.
- **Fieldset:** the HTML element that groups form controls under a legend; browsers give it a min-content minimum width by default.
- **CDP (Chrome DevTools Protocol):** the protocol the developer tools use to drive Chrome; the UI check here used it directly to open pages, measure elements and take screenshots in a throwaway profile.
