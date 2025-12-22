# Lazy LaTeX

Write LaTeX math *lazily* using your favorite LLM.

Type fuzzy / natural language math between tiny markers, hit **Enter**, and Lazy LaTeX turns it into real LaTeX — right inside your `.tex` or `.md` file. It also offers a mode to **insert arbitrary content** (proofs, summaries, diagrams, boilerplate). Featured with customizable style control and context awareness. Supports any OpenAI-style API (including Google Gemini) and Anthropic Claude.

------

## What it does


With this extension, you no longer need to follow the LaTeX syntax strictly. All you need to do is write LaTeX in a fuzzy way, or simply describe the formulas you want.

In a LaTeX or Markdown file, you can, for example, write:

```tex
Consider the function ;;f (x) = (x+2 if x >= 0, 2 otherwise);;. Its definite integral from $-2$ to $2$ is ;;;int from -2 to 2 f(x) dx;;; Now consider the function ;;g = f + 1 but same format as f;;.
```


Press **Enter** and it becomes:

```tex
Consider the function $f(x) = \begin{cases} x + 2 & \text{if } x \geq 0 \\ 2 & \text{otherwise} \end{cases}$. Its definite integral from $-2$ to $2$ is 
$$
\int_{-2}^{2} f(x) \, dx
$$
Now consider the function $g(x) = \begin{cases} x + 3 & \text{if } x \geq 0 \\ 3 & \text{otherwise} \end{cases}$.
```
which can be rendered correctly by LaTeX or Markdown.

Note that the wrapper `;;...;;` gives inline math and `;;;...;;;` display math. Anything outside of these wrappers will not be touched, so you may still write strict LaTeX formulas with the usual wrappers (`$...$` etc.) if you need to.

You can also select any text and run
 **`Lazy LaTeX: Convert selection to math`** (Ctrl+Alt+M) to turn it into a single LaTeX math expression. This may be used to fix bugged LaTeX formulas.

And for more general tasks, you can write with the wrapper `;;;;...;;;;`:

```tex
;;;;write a one-sentence summary of the previous paragraph;;;;
```

Press **Enter**, and it will insert that summary in place of the wrapper.

------

## Quick start

1. **Install the extension**
    Search for **“Lazy LaTeX”** in the VS Code Extensions view and install it.

2. **Open a LaTeX or Markdown project**
    Open a folder that contains `.tex` or `.md` files.

3. **Configure your LLM**
    In VS Code, go to **Settings → search “Lazy LaTeX”**.
    Set at least:

   - `Lazy-latex › Llm: Provider` (Note: choose `openai` for any OpenAI-compatible APIs; see examples below.)
     - `openai` | `anthropic`
   - `Lazy-latex › Llm: Endpoint`
   - `Lazy-latex › Llm: Api Key` (Note: you need to get this from your LLM provider.)
   - `Lazy-latex › Llm: Model`

   Examples:

  - **OpenAI**
    - Provider: `openai`
    - Endpoint: `https://api.openai.com/v1/chat/completions`
    - Model: `gpt-4o-mini` (or similar)
  - **Anthropic (Claude)**
    - Provider: `anthropic`
    - Endpoint: `https://api.anthropic.com/v1/messages`
    - Model: `claude-haiku-4-5` (or another Claude 3 model)
  - **DeepSeek**
    - Provider: `openai`
    - Endpoint: `https://api.deepseek.com/v1/chat/completions`
    - Model: `deepseek-chat`
  - **Doubao (ByteDance / 火山引擎豆包)**
    - Provider: `openai`
    - Endpoint: `https://ark.cn-beijing.volces.com/api/v3/chat/completions`
    - Model: `doubao-1-5-pro-32k-250115` (other Doubao chat models may also work)
  - **Gemini (OpenAI-compatible)**
    - Provider: `openai`
    - Endpoint: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
    - Model: `gemini-2.5-flash` (or similar)
  - **Ollama (local models)**
    - Provider: `openai`
    - Endpoint: `http://localhost:11434/v1/chat/completions`
    - Model: any local model you’ve pulled in Ollama (e.g. `qwen2.5:7b`, `llama3.1:8b`)
    - Note: when using `localhost` / `127.0.0.1` endpoints, the API key can be left blank.
  
4. **Try it once**
    In a `.tex` or `.md` file:

   ```tex
   Let ;;cal C;; be a locally small category. Then ;;h_A := mathrm Hom(A, -);; is a functor ;;C -> Set (with bold);;. The Yoneda Lemma states that for any functor ;;F : C ->Set;;, there is a bijection ;;mathrm Nat(h_A, F) iso F(A);;. 
   ```

   Press **Enter** → all the `;;…;;` wrappers are replaced with real LaTeX math, in consistent notation:

   ```tex
   Let $\mathcal{C}$ be a locally small category. Then $h_A := \mathrm{Hom}(A, -)$ is a functor $\mathcal{C} \to \mathbf{Set}$. The Yoneda Lemma states that for any functor $F : \mathcal{C} \to \mathbf{Set}$, there is a bijection $\mathrm{Nat}(h_A, F) \cong F(A)$. 
   ```

   > Let $\mathcal{C}$ be a locally small category. Then $h_A := \mathrm{Hom}(A, -)$ is a functor $\mathcal{C} \to \mathbf{Set}$. The Yoneda Lemma states that for any functor $F : \mathcal{C} \to \mathbf{Set}$, there is a bijection $\mathrm{Nat}(h_A, F) \cong F(A)$. 
 

That’s enough to start using it.

------

## Detailed usage

### 1. Auto-convert wrappers on Enter

In **LaTeX** and **Markdown** files:

- `;; ... ;;` → **inline math**
- `;;; ... ;;;` → **display math**

When you press **Enter** on that line:

- The wrappers are removed
- The content inside is converted to LaTeX
- Math is wrapped in appropriate delimiters

**Note:** If a wrapper is followed by a semicolon (actual punctuation), add a space before the semicolon: `;;expression;; ;`. The space will be automatically removed during conversion, leaving just the semicolon.

You can turn auto-conversion off or on via:

- `lazy-latex.autoReplace` (default `true`)

#### Output delimiters

- In **LaTeX**, you can choose how the math is wrapped:

  - Inline:
    - `lazy-latex.output.latex.inlineStyle = "dollar"` → `$...$` (default)
    - `lazy-latex.output.latex.inlineStyle = "paren"` → `\(...\)`
  - Display:
    - `lazy-latex.output.latex.displayStyle = "brackets"` → `\[...\]` (default)
    - `lazy-latex.output.latex.displayStyle = "dollars"` → `$$...$$`

- In **Markdown**, output is always `$...$` for inline math and `$$...$$` for display.

------

### 2. Auto-convert wrappers on save

You can configure Lazy LaTeX to automatically convert all wrappers in your document when you save (Ctrl+S). This is controlled by the `lazy-latex.convertOnSave` setting with three options:

- **`"none"`** (default): No automatic conversion on save.
- **`"save-convert-save"`**: Save the document first (creating a backup), then convert all wrappers, then save again. This is safer because your original file is saved before any conversions happen.
- **`"convert-save"`**: Convert all wrappers first, then save. This prevents LaTeX compilers from seeing unconverted wrappers if they run automatically on save. Note: If the conversion fails (e.g., API error), the file will still be saved with unconverted wrappers.

This is particularly useful when:
- You want to ensure all wrappers are converted before compiling your LaTeX document
- You have many wrappers throughout the document and don't want to manually convert them
- You want to batch-convert everything at once

------

### 3. Manual commands: convert selection or current line

#### Convert selection

If you don't want wrappers, or you're editing existing text (e.g. **fixing a bugged LaTeX formula**):

1. Select some text (natural language or messy math).
2. Run the command:
   - Command Palette: **"Lazy LaTeX: Convert selection to math"**
   - Or default keybinding: **Ctrl+Alt+M**

The selection is replaced by a **single LaTeX math expression** (no surrounding `$` or `$$`).

This works in both `.tex` and `.md` files.

#### Convert current line

To convert wrappers on the current line without pressing Enter:

- Command Palette: **"Lazy LaTeX: Convert wrappers on current line"**
- Or default keybinding: **Ctrl+Alt+L**

This converts all `;;...;;` and `;;;...;;;` wrappers on the line where your cursor is, without inserting a newline. Useful when you want to convert wrappers but don't want to move to the next line.

------

### 4. Insert-anything wrappers: `;;;;...;;;;`

Sometimes you want more than just a small formula:

- A short summary of the previous paragraph
- A quick proof sketch
- A TikZ diagram snippet
- A Mermaid block in Markdown
- Some LaTeX boilerplate you don’t remember

For that, use **four semicolons**:

```tex
;;;;write a one-sentence summary of the previous paragraph;;;;
```

or:

```tex
;;;;give a short proof sketch that this operator is self-adjoint;;;;
```

When you press **Enter**:

- The `;;;;...;;;;` wrapper is removed.
- The LLM generates **whatever text best matches the instruction**, using:
  - Your project conventions (`.lazy-latex.md`),
  - Global instructions (`lazy-latex.prompt.extra`),
  - Previous lines as context,
  - The raw current line (with wrappers).

The output is inserted **as-is**.

`;;;;...;;;;` is a general “LLM macro” that lets you use the model as a context-aware writing assistant inside your document.

------

## Style customization 

You control the “style” of math in two layers.

### 1. Per-project conventions: `.lazy-latex.md` (HIGH priority)

In your project root, create:

- `.lazy-latex.md`

Write anything you want the model to follow for this project, for example:

```markdown
# LaTeX conventions for this project

- Use \mathbf for vectors.
- Use \mathbb for sets and number systems.
- Use \mathrm{d}x in integrals.
- f(x) always denotes a probability density function on \mathbb{R}.
```

This is treated as **high-priority**: project-specific rules.

### 2. Global/workspace extras: `lazy-latex.prompt.extra` (LOWER priority)

In VS Code settings, there is:

- `Lazy-latex › Prompt: Extra` (`lazy-latex.prompt.extra`)

Anything you put there is appended as extra system instructions.

If both exist:

- `.lazy-latex.md` = **HIGH PRIORITY** (project rules)
- `lazy-latex.prompt.extra` = **LOWER PRIORITY** (generic rules)

Lazy LaTeX tells the LLM explicitly to obey the project file over the global setting.

These instructions apply to **all wrappers**:

- Math wrappers (`;;...;;`, `;;;...;;;`)
- Insert-anything wrappers (`;;;;...;;;;`)

So you can, for example, enforce vector styles and also say "summaries should be at most two sentences" or "draw all diagrams with TikZ".

------

## Context awareness 

Lazy LaTeX sends some of your document as context so the LLM can use earlier definitions and keep notation consistent.

### Previous lines

- `lazy-latex.context.lines` (integer, default `50`)

Controls how many **previous lines** are sent as context. For example:

- `0` → no previous lines (only the current line + your prompts)
- `10`, `50`, … → last N lines above the current line
- A large value (`9999`) → effectively the entire file above the current line

### Current line and multiple wrappers

When you press Enter:

- The **full current line** (with `;;...;;` / `;;;...;;;` / `;;;;...;;;;` still present) is sent too.
- If a line has multiple wrappers, they are sent **together** in one request (for math), so the LLM can keep them consistent.

<!-- For example:

```tex
Let ;;vec u, v in RRn;;. Write ;;u = (column vector with u_i);; and ;;v = (similar as u);;. Then we have ;;;u + v = (col vec with entry-wise addition);;;.
```

can turn into something like:

```tex
Let $\vec{u}, \vec{v} \in \mathbb{R}^n$. Write
$\vec{u} = \begin{pmatrix} u_1 \\ \cdots \\ u_n \end{pmatrix}$
and
$\vec{v} = \begin{pmatrix} v_1 \\ \cdots \\ v_n \end{pmatrix}$.
Then we have
\[
\vec{u} + \vec{v}
= \begin{pmatrix} u_1 + v_1 \\ \cdots \\ u_n + v_n \end{pmatrix}.
\]
``` -->

<!-- All generated in one go, with consistent notation. -->

<!-- The same context is also visible to `;;;;...;;;;` wrappers. -->

------

## Optional: keep your original input as comments

If you like to see what you originally typed, enable:

- `lazy-latex.keepOriginalComment` (default `false`)

When it’s `true`, before rewriting a line, Lazy LaTeX inserts your original line as a comment above it:

- In **LaTeX**:

  ```tex
  % [lazy-latex input] This is ;;integral from 0 to 1 of x squared dx;;
  This is $\int_0^1 x^2 \, dx$
  ```

- In **Markdown**:

  ```md
  <!-- [lazy-latex input] This is ;;integral from 0 to 1 of x squared dx;; -->
  $$
  \int_0^1 x^2 \, dx
  $$
  ```

Handy for debugging or learning how the LLM is interpreting your text, especially when experimenting with `;;;;...;;;;`.

------

## Configuration (quick reference)

Open **Settings** → search for `Lazy LaTeX`.

Key options:

- **`lazy-latex.autoReplace`** (boolean, default `true`)
   Automatically convert `;;...;;`, `;;;...;;;`, and `;;;;...;;;;` wrappers on Enter in `.tex` / `.md` files.
- **`lazy-latex.convertOnSave`** (string: `"none"` | `"save-convert-save"` | `"convert-save"`, default `"none"`)
   How to handle wrapper conversion when saving (Ctrl+S). See the "Auto-convert wrappers on save" section above for details.
- **`lazy-latex.llm.provider`** (string, default `"openai"`)
   Which protocol/provider to use:
  - `"openai"` — any OpenAI-compatible chat completion API (OpenAI, DeepSeek, Doubao, Gemini’s OpenAI-compatible endpoint, Ollama, etc.)
  - `"anthropic"` — Claude via Anthropic Messages API
- **`lazy-latex.llm.endpoint`** (string)
   Endpoint URL for your provider, for example:
  - OpenAI: `https://api.openai.com/v1/chat/completions`
  - DeepSeek: `https://api.deepseek.com/v1/chat/completions`
  - Doubao: `https://ark.cn-beijing.volces.com/api/v3/chat/completions`
  - Gemini (OpenAI-compatible): `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
  - Anthropic (Claude): `https://api.anthropic.com/v1/messages`
  - Ollama (local): `http://localhost:11434/v1/chat/completions`
- **`lazy-latex.llm.apiKey`** (string, secret)
   API key for your provider.
  - For **remote** providers (OpenAI, DeepSeek, Doubao, Gemini, Anthropic), this is required.
  - For **local** endpoints on `localhost` / `127.0.0.1` (e.g. Ollama), this can be left empty and Lazy LaTeX will not send an `Authorization` header.
- **`lazy-latex.llm.model`** (string)
   Model name used for generation, for example:
  - OpenAI: `gpt-4o-mini`
  - DeepSeek: `deepseek-chat`
  - Doubao: `doubao-1-5-pro-32k-250115`
  - Gemini: `gemini-2.5-flash`
  - Anthropic: `claude-haiku-4-5`
  - Ollama: any local model you’ve pulled (e.g. `qwen2.5:7b`, `llama3.1:8b`)
- **`lazy-latex.prompt.extra`** (string)
   Extra global/workspace instructions (lower priority than `.lazy-latex.md`).
- **`lazy-latex.context.lines`** (integer, default `50`)
   Number of previous lines to send as context.
- **`lazy-latex.output.latex.inlineStyle`** (string: `"dollar"` | `"paren"`, default `"dollar"`)
   How to wrap inline math in LaTeX: `$...$` vs `\(...\)`.
- **`lazy-latex.output.latex.displayStyle`** (string: `"brackets"` | `"dollars"`, default `"brackets"`)
   How to wrap display math in LaTeX: `\[...\]` vs `$$...$$`.
- **`lazy-latex.keepOriginalComment`** (boolean, default `false`)
   Insert the original line as a comment above the generated LaTeX / Markdown.
------

## Error handling & debugging

When something goes wrong with the LLM call (bad API key, wrong endpoint/model, rate limits, etc.):

- Lazy LaTeX shows a **friendly error message** explaining the likely cause (authentication, 404, rate limit, server error, or generic failure).
- Detailed information is written to the **“Lazy LaTeX”** output channel:
  - Provider (from settings)
  - Endpoint
  - Model
  - HTTP status (when available)
  - Provider’s error body (truncated)

You can open this via:

- **View → Output → choose “Lazy LaTeX”** in the dropdown.

------

## Requirements

- VS Code `^1.106.0`
- An LLM provider:
  - OpenAI-compatible chat completion endpoint, or
  - Anthropic Claude Messages API, or
- A valid API key and model name for that provider

------

## Notes

- It should go without saying that there is no absolute guarantee that LLM outputs are correct. **Always check the outputs carefully.**
- Using an LLM API may **incur costs** as specified by your provider, although in our use case the costs should usually be tiny.
- Auto-replacement only runs in files with language id `latex` or `markdown`.
- Wrappers on pure comment lines are ignored:
  - `% ...` in LaTeX
  - `<!-- ... -->` in Markdown
- The extension does **not** store your API key or send telemetry; it just forwards prompts to your configured endpoint.
- This project is mostly vibe-coded with the help of ChatGPT 5.1 Thinking.