# Import a Pack from a Folder

Use this for Markdown notes already on your computer.

## Steps

1. Put at least one Markdown (`.md`) file in a folder.
2. Open **Hub → Import → Create from folder**.
3. Choose the folder.
4. Review the suggested pack name and details.
5. Select **Create pack**.

Nest copies the files into its local vault; your original folder is
unchanged. Open **Explorer** to read the new pack.

## Example structure

```text
my-notes/
  README.md
  guides/
    first-topic.md
  images/
    diagram.png
```

## About `pack.json`

You don't need to create it yourself — Nest suggests an ID, name, version, and
description, then writes the file for you. If the folder already has one,
Nest uses it as the starting point.
