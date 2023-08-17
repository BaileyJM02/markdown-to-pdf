# Markdown to PDF
[![CI](https://github.com/BaileyJM02/markdown-to-pdf/actions/workflows/main.yml/badge.svg)](https://github.com/BaileyJM02/markdown-to-pdf/actions/workflows/main.yml)

Creates PDF and HTML files from Markdown using the GitHub (or custom) theme.

## Notable Features:

- Code highlighting
- Tables
- Images (see docs)
- Internal and external links

## GitHub Action Inputs

### Input Path

```yaml
with:
  input_path: value
```

(**Required**)
([Path](#path)) or ([File](#file))
The location of the folder containing your .md or .markdown files, or a path to a single .md or .markdown file that you would like to convert.

*Note, previous versions of this action accepted the `input_dir` input. This is still accepted as input for backwards compatibility, but passing a directory as `input_path` now carries out the same functionality.

### Images Directory

```yaml
with:
  images_dir: value
```

([Path](#path))
The location of the folder containing your images, this should be the route of all images. So of you had images located
at `images/about/file.png` and `images/something-else/file.png` you would pass the value `images`.

### Output Directory

```yaml
with:
  output_dir: value
```

([Path](#path))
The location of the folder you want to place the built files.

### Image Import Prefix

```yaml
with:
  image_import: value
```

([String](#string))
The path you use to import your images that can be replaced with the server URL. For example if you
had `<img src="./images/something-else/file.">` you would pass `./images` as this is replaced
by `https://localhost:3000` during the build process.

### Build HTML

```yaml
with:
  build_html: value
```

([Boolean](#boolean))
Whether to also create a .html file.

### Build PDF

```yaml
with:
  build_pdf: value
```

([Boolean](#boolean))
Whether to also create a .pdf file (defaults to `true`. After all, this is the intended behaviour).

### CSS Theme

```yaml
with:
  theme: value
```

([File](#file))
The location of the CSS file you want to use as the theme.

```yaml
with:
  extend_default_theme: value
```

([Boolean](#boolean))
Whether to extend your custom CSS file with the default theme

### Highlight CSS Theme

```yaml
with:
  highlight_theme: value
```

([File](#file))
The location of the CSS file you want to use as the code snipped highlight theme.

### HTML/Mustache Template file

```yaml
with:
  template: value
```

([File](#file))
The location of the HTML/Mustache file you want to use as the HTML template.

### Table Of Contents

```yaml
with:
  table_of_contents: value
```

([Boolean](#boolean))
Whether a table of contents should be generated

## Input Types

A few pieces to describe what input each value expects.

### Path

A path will most likely be from your repository's route, it should not be prefixed or suffixed with a `/`. The path
should look like so `docs/topic/featureDocs` or `writing/category`.

### String

A string could be anything, and using `YAML` (or `YML`) does not need to be encased in quotes.

### Boolean

This should be either `true` or `false`.

### File

This should be the direct path to a file, it should not be prefixed with a `/`. An example: `styles/markdown-theme.css`.

## Usage Examples

An example of a workflow for some documentation.

````yml
# .github/workflows/convert-to-pdf.yml

name: Docs to PDF
# This workflow is triggered on pushes to the repository.
on:
  push:
    branches:
      - main
    # Paths can be used to only trigger actions when you have edited certain files, such as a file within the /docs directory
    paths:
      - 'docs/**.md'
      - 'docs/images/**'

jobs:
  converttopdf:
    name: Build PDF
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: baileyjm02/markdown-to-pdf@v1
        with:
          input_dir: docs
          output_dir: pdfs
          images_dir: docs/images
          # for example <img src="./images/file-name.png">
          image_import: ./images
          # Default is true, can set to false to only get PDF files
          build_html: false
      - uses: actions/upload-artifact@v3
        with:
          name: docs
          path: pdfs

````

## Contributions

Any contributions are helpful, please make a pull-request. If you would like to discuses a new feature, please create an
issue first.
