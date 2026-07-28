# Import a Pack from a Folder

Use this option when you already have Markdown notes or documentation in a
folder on your computer.

## What you need

- A folder containing at least one Markdown (`.md`) file.
- A clear name for the pack.

`pack.json` is optional. If the folder does not contain one, Nest derives
initial details from the folder name, asks you to confirm the pack ID, name,
version, and optional description, then generates `pack.json` in the installed
copy automatically.

If the folder already has a valid `pack.json`, Nest uses its values as the form
defaults. You can review them before importing.

## Import the folder

1. Open **Hub** and choose **Import**.
2. Select **Create from folder**.
3. Choose the folder containing your Markdown files.
4. Review the generated or discovered pack details.
5. Select **Create pack**.

Nest copies supported Markdown and image files into its local vault. Your
original folder is left unchanged.

## Good folder structure

```text
my-notes/
  README.md
  guides/
    first-topic.md
  images/
    diagram.png
```

After import, the installed copy also contains the generated `pack.json`. Keep
the pack ID stable if you later publish it.
