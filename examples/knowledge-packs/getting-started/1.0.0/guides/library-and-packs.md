# Library and Knowledge Packs

## Browse and activate

The Explorer sidebar shows pack folders and files. Open a file to read it.
Activate or deactivate a pack from its pack actions:

- active packs are available to general Chat retrieval;
- inactive packs stay installed and readable;
- changing active state does not delete content.

## Install from Hub

Open Hub, browse the catalog, choose a version, and download it. Nest keeps one
installed version per pack ID. Installing another version replaces the current
files after confirmation.

## Import a local pack

Import a ZIP whose top level contains one pack folder:

```text
my-pack/
  pack.json
  README.md
  guides/
```

Required `pack.json` fields are `id`, `name`, `description`, and a semantic
`version` such as `1.0.0`. The ID uses lowercase letters, numbers, and hyphens.

## Create a pack from a folder

Use the Library create action, provide stable metadata, and add Markdown files.
Keep the ID stable after publishing. Organize related pages in clear folders
and link them from the pack README.

## Update, export, and remove

- **Update** installs a newer Hub release.
- **Export** creates a portable ZIP of the installed pack.
- **Remove** deletes the local copy and removes it from Chat scope.

Removing a local pack does not delete its Hub project or published releases.
