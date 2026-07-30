# Import a Pack from a Folder

Use this option to bring Markdown notes or documentation already on your
computer into Nest.

## Quick import

1. Put at least one Markdown (`.md`) file in a folder.
2. Open **Hub** and choose **Import**.
3. Select **Create from folder**.
4. Choose the folder containing your Markdown files.
5. Review the suggested pack name and details.
6. Select **Create pack**.

Nest copies supported Markdown and image files into its local vault. Your
original folder stays unchanged. Open **Explorer** to find and read the new
pack.

## Example folder

```text
my-notes/
  README.md
  guides/
    first-topic.md
  images/
    diagram.png
```

Folders can be organized however they make sense to readers. Relative links and
images continue to work when their target files are included.

## About pack details

You do not need to create `pack.json` yourself. Nest suggests an ID, name,
version, and optional description, then creates the required metadata in the
installed copy. If the folder already contains valid pack metadata, Nest uses
it as the starting point for the form.

Keep the pack ID stable if you later publish updates under the same Hub entry.
