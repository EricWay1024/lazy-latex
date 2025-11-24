# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.4] - 2025-11-23

### Added

- More instructions in the README for extra LLM model choices.

### Changed

- Better handling of punctuations and whitespaces after displayed math.
- Gemini is no longer listed as a provider since it uses the same protocol as OpenAI.
- Remove redundant bits in the README.

## [0.1.3] - 2025-11-22

### Added

;;;;...;;;; insert-anything mode: use four semicolons as a wrapper to ask the LLM to insert arbitrary LaTeX/Markdown content based on the surrounding context. This can be used for things like short proofs, summaries, diagram snippets, or boilerplate you don’t remember how to write.

### Changed

When LLM calls fail, a friendly error dialog is shown. Errors are logged to the “Lazy LaTeX” output channel with provider, endpoint, model, status, and provider response to make debugging configuration issues easier.

## [0.1.2] - 2025-11-22

### Added

This extension now has an icon.

## [0.1.1] - 2025-11-22

### Added

- Configurable LaTeX output delimiters (`$...$` vs `\(...\)` and `\[...\]` vs `$$...$$`).
- Markdown support with automatic `$...$` / `$$...$$` output and HTML-style comments.
- Display math normalization: ensure display blocks start on their own line when needed.

## [0.0.1] - 2025-11-21

### Added

- Initial release of the Lazy LaTeX VS Code extension.
- Auto-convert `;;...;;` (inline) and `;;;...;;;` (display) markers to LaTeX on Enter.
- Manual command `Lazy LaTeX: Convert selection to math` with default binding `Ctrl+Alt+M`.
- Per-project configuration via `.lazy-latex.md` (high-priority) plus extra instructions via `lazy-latex.prompt.extra` (lower-priority).
- Basic OpenAI-compatible LLM integration using endpoint/model/API key from settings.
- Configurable number of context lines (`lazy-latex.context.lines`).
- Option to keep original input as a comment above the generated math in both LaTeX and Markdown.
- Support for multiple LLM providers via a tiny wrapper:
  - OpenAI-compatible APIs
  - Anthropic Claude (`/v1/messages`)
  - Gemini via the OpenAI-compatible endpoint.
- Context awareness:
  - Send previous lines and the full current line to the LLM.
  - Batch process multiple wrappers on the same line in a single LLM call for consistency.
