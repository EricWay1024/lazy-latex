# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
