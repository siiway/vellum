---
title: OPS Image & Video
description: "Triple-colon :::image::: and :::video::: self-closing blocks."
---

# OPS Image & Video

The OPS image and video directives are richer than plain markdown's
`![]()` and `<video>`. They accept named attributes and render to figures
with optional captions, borders, and lightbox links.

## Basic image

:::image source="https://icons.siiway.org/siiway/icon.svg" alt-text="SiiWay icon" type="content":::

## Image with border

:::image source="https://icons.siiway.org/prism/icon.svg" alt-text="Prism icon" type="content" border="true":::

## Image with lightbox (click to open original)

:::image source="https://icons.siiway.org/glint/icon.svg" alt-text="Glint icon" type="content" lightbox="https://icons.siiway.org/glint/icon.svg":::

## Video — YouTube embed

:::video source="https://www.youtube.com/embed/dQw4w9WgXcQ":::

## Video — direct media file

The renderer picks `<video controls>` for `.mp4` / `.webm` / `.ogg` URLs and
`<iframe>` for everything else. With a direct file URL it looks like this:

:::video source="https://www.w3schools.com/html/mov_bbb.mp4" title="Big Buck Bunny clip":::

## Mixed with prose

Paragraphs around images flow normally. The figure has its own block
margin so it doesn't crowd the surrounding text:

:::image source="https://icons.siiway.org/siiway/icon.svg" alt-text="SiiWay icon" type="content":::

That image lives between two paragraphs and shouldn't break the rhythm of
the page.
