---
tags: [sample]
status: frontmatter is never read aloud
---

# Markdown features

Read this note in each mode. Everything that is only for the writer, like this note's frontmatter, its comments and its code, is skipped. What a reader would see is read.

## Text and emphasis

Some words are in **bold**, some in _italics_, some ==highlighted== and some ~~struck through~~, and they are read the same as any other word. A [link to the welcome note](Welcome.md) is read by its text, and so is a [[Numbers and units|wiki link with an alias]]. A bare address like https://obsidian.md is skipped.

This paragraph is written
across several lines, the way
some people wrap their notes,
and it is still read as one sentence.

%% This comment is for the writer only and is never read. %%

## Lists

- The first item in a list.
- A second item, with a [[Welcome|link]] in it.
  - A nested item.

1. A numbered item.
2. Another numbered item.

## Callouts and quotes

> [!note] A callout
> Callouts are read, title and all, and highlighted in Live Preview where they are rendered.

> A plain quotation, read like a paragraph.

## Maths and tags

Maths is skipped, both inline, like $E = mc^2$ here, and in blocks. So are tags like #sample.

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

## Code

Inline `code` is skipped, and so is this block:

```js
console.log("This is never read aloud.");
```

## Tables

| Tables  | are |
| ------- | --- |
| skipped | too |

## Embeds

![[Welcome]]

The embed above is skipped. This sentence, after it, is the last one read.
