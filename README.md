# Lazy LaTeX

Write LaTeX math lazily using an LLM.

Lazy LaTeX lets you type fuzzy / natural language math and turns it into real LaTeX formulas, either:

- **Automatically**, using special wrappers like `;;...;;` and `;;;...;;;` when you press Enter in a `.tex` file.
- **Manually**, via a command that converts the current selection.

You bring your own LLM (OpenAI-compatible HTTP API), and you can tune notation conventions per project with a simple text file.

---

## Features

### 1. Auto-convert `;;...;;` and `;;;...;;;` on Enter

In LaTeX files (`.tex`, language `latex`):

- `;; ... ;;` → **inline math**
- `;;; ... ;;;` → **display math**

Example:

```tex
This is ;;integral from 0 to 1 of x squared dx;;.

And here is display:

;;;sum from i=1 to n of a_i;;;
```

After you press **Enter** on that line, Lazy LaTeX will:

- Call your configured LLM
- Replace wrappers with real LaTeX:

```latex
This is $\int_0^1 x^2\,dx$.

And here is display:

\[
\sum_{i=1}^n a_i
\]
```

Auto replacement can be enabled/disabled via a setting.

---

### 2. Manual command: convert selection to LaTeX

You can also select any text (natural language or messy LaTeX) and run:

- **Command Palette** → `Lazy LaTeX: Convert selection to math`
- Or the default keybinding: **Ctrl+Alt+M**

The selected text is replaced by a single LaTeX math expression (no surrounding `$`).

---

### 3. Per-project conventions with `.lazy-latex.md`

In each project, you can create a file named `.lazy-latex.md` in the workspace root, and write any instructions you want the LLM to follow for this project, for example:

```latex
# LaTeX conventions for this project

- Use \mathbf for vectors.
- Use \mathbb for number sets.
- Use \mathrm{d}x in integrals.
- f(x) always denotes a probability density function on \mathbb{R}.
```

Lazy LaTeX will read this file and include it in the system prompt as **high-priority project settings**.

---

### 4. Extra instructions via VS Code settings

There is also a user/workspace setting:

- `lazy-latex.prompt.extra`

Anything you put there is appended to the system prompt as **lower-priority user settings**.

If both exist:

- `.lazy-latex.md` is treated as **HIGH PRIORITY**
- `lazy-latex.prompt.extra` is treated as **LOWER PRIORITY**

The system prompt roughly looks like:

```md
Rules:
- Output ONLY the LaTeX math expression itself.
- No $ or $$.
- No explanations or comments.

Additional instructions follow.

HIGH PRIORITY from project settings:
<contents of .lazy-latex.md>

LOWER PRIORITY from user settings:
<lazy-latex.prompt.extra>
```

---

## Configuration

Open **Settings** → search for `Lazy LaTeX`.

Available options:

- **`lazy-latex.autoReplace`** (boolean, default `true`)
   Automatically convert `;;...;;` and `;;;...;;;` wrappers on Enter in `.tex` files.
- **`lazy-latex.llm.endpoint`** (string)
   HTTP endpoint for an OpenAI-compatible chat completion API.
   Example: `https://api.openai.com/v1/chat/completions`
- **`lazy-latex.llm.apiKey`** (string, secret)
   API key for your LLM provider.
- **`lazy-latex.llm.model`** (string)
   Model name used for generation, e.g. `gpt-4o-mini`.
- **`lazy-latex.prompt.extra`** (string)
   Extra system-level instructions (lower priority than `.lazy-latex.md`).

---

## Requirements

- VS Code `^1.106.0`
- An OpenAI-compatible chat completion endpoint
- A valid API key and model name

---

## Usage

1. Open a folder with your LaTeX project in VS Code.
2. (Optional) Create `.lazy-latex.md` in the project root and describe your notation conventions.
3. Configure:
   - `Lazy-latex › Llm: Endpoint`
   - `Lazy-latex › Llm: Api Key`
   - `Lazy-latex › Llm: Model`
4. In a `.tex` file:
   - Type `;;your math description;;` or `;;;your display math description;;;`
   - Press **Enter** → wrappers are replaced with LaTeX.
5. Or manually:
   - Select text → `Lazy LaTeX: Convert selection to math` (Ctrl+Alt+M).

---

## Notes

- Auto-replacement only runs in files with language id `latex` (e.g. `.tex`).
- The extension does not store your API key or send telemetry; it just forwards your prompts to the configured endpoint.
