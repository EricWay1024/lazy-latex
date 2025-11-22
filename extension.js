const vscode = require('vscode');
const { generateLatexFromText, generateLatexForBatch } = require('./llmClient');

/**
 * Get output math delimiters for the given document.
 *
 * - LaTeX: configurable via settings
 * - Markdown: fixed to $...$ and $$...$$
 *
 * @param {vscode.TextDocument} document
 * @returns {{ inline: { open: string, close: string }, display: { open: string, close: string } }}
 */
function getOutputDelimiters(document) {
  const lang = document.languageId;

  // Markdown: always $ / $$
  if (lang === 'markdown') {
    return {
      inline: { open: '$', close: '$' },
      display: { open: '$$', close: '$$' },
    };
  }

  // Default: LaTeX
  const config = vscode.workspace.getConfiguration('lazy-latex');
  const inlineStyle = config.get('output.latex.inlineStyle', 'dollar');
  const displayStyle = config.get('output.latex.displayStyle', 'brackets');

  const inline =
    inlineStyle === 'paren'
      ? { open: '\\(', close: '\\)' }
      : { open: '$', close: '$' };

  const display =
    displayStyle === 'dollars'
      ? { open: '$$', close: '$$' }
      : { open: '\\[', close: '\\]' };

  return { inline, display };
}


/**
 * Get context from previous N lines before a given line number.
 * N is read from `lazy-latex.context.lines`.
 *
 * If contextLines = 0, returns an empty string.
 * If contextLines is large, this may include the entire file above the line.
 *
 * @param {vscode.TextDocument} document
 * @param {number} lineNumber
 * @returns {string}
 */
function getContextBeforeLine(document, lineNumber) {
  const config = vscode.workspace.getConfiguration('lazy-latex');
  const contextLines = config.get('context.lines', 5);

  if (!contextLines || contextLines <= 0) {
    return '';
  }

  const startLine = Math.max(0, lineNumber - contextLines);
  const endLine = lineNumber - 1;

  if (endLine < startLine) {
    return '';
  }

  const lines = [];
  for (let ln = startLine; ln <= endLine; ln++) {
    lines.push(document.lineAt(ln).text);
  }
  return lines.join('\n');
}

/**
 * Find all ;;...;; (inline) and ;;;...;;; (display) wrappers in a single line.
 * Returns an array of:
 *   { type: 'inline' | 'display', inner: string, start: number, end: number }
 * where start/end are character indices in the line (end = index after closing delimiters).
 *
 */
function findMathWrappersInLine(lineText) {
  const trimmed = lineText.trim();
  if (trimmed.startsWith('%')) {
    // Entire line is a comment: do not touch any wrappers here.
    return [];
  }

  // Markdown / HTML-style pure comment line: <!-- ... -->
  if (trimmed.startsWith('<!--') && trimmed.endsWith('-->')) {
    return [];
  }

  const results = [];
  const n = lineText.length;
  let i = 0;

  while (i < n) {
    if (lineText[i] === ';') {
      // Count how many consecutive semicolons
      let j = i;
      while (j < n && lineText[j] === ';') {
        j++;
      }
      const count = j - i;

      if (count === 2 || count === 3) {
        const type = count === 2 ? 'inline' : 'display';
        const contentStart = j;

        // Look for matching closing delimiter of the same length
        let k = contentStart;
        let found = false;

        while (k < n) {
          if (lineText[k] === ';') {
            let m = k;
            while (m < n && lineText[m] === ';') {
              m++;
            }
            const endCount = m - k;

            if (endCount === count) {
              const contentEnd = k;
              const inner = lineText.slice(contentStart, contentEnd);
              results.push({
                type,
                inner,
                start: i,
                end: m, // index AFTER the closing delimiters
              });

              i = m; // continue parsing after this wrapper
              found = true;
              break;
            } else {
              k = m; // skip this run of semicolons
            }
          } else {
            k++;
          }
        }

        if (!found) {
          // No closing delimiter found; just move on to avoid infinite loop
          i = j;
        }
      } else {
        // 1 or >=4 semicolons: ignore as wrapper
        i = j;
      }
    } else {
      i++;
    }
  }

  return results;
}

// Guard so our own edits don't re-trigger processing
let isApplyingLazyLatexEdit = false;

/**
 * Given a document line and the detected wrappers, call the LLM in batch mode
 * and replace ;;...;; / ;;;...;;; with real LaTeX ($...$ or \[...\]).
 */
async function processLineForWrappers(document, lineNumber, wrappers) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  if (editor.document !== document) return;
  if (!wrappers || wrappers.length === 0) return;

  const status = vscode.window.setStatusBarMessage(
    'Lazy LaTeX: auto-generating LaTeX for this line...'
  );

  // Compute context once per line (previous lines only)
  const previousContext = getContextBeforeLine(document, lineNumber);

  // Read config for keeping original input as a comment
  const config = vscode.workspace.getConfiguration('lazy-latex');
  const keepOriginalComment = config.get('keepOriginalComment', false);
  const outputDelims = getOutputDelimiters(document);

  // Capture the original line text before any edits (full current line)
  let originalLineText = '';
  try {
    originalLineText = document.lineAt(lineNumber).text;
  } catch {
    originalLineText = '';
  }

  // Prepare descriptions for batch call (inner texts trimmed)
  const descriptions = wrappers.map((w) => (w.inner || '').trim());

  // Call LLM in batch mode, giving it previous lines + full current line
  let latexList;
  try {
    latexList = await generateLatexForBatch(
      descriptions,
      previousContext,
      originalLineText
    );
  } catch (err) {
    console.error('[Lazy LaTeX] Batch LLM error for line', lineNumber, err);
    return;
  }

  // Build replacements from outputs
  const replacements = [];
  for (let idx = 0; idx < wrappers.length; idx++) {
    const w = wrappers[idx];
    const latex = (latexList[idx] || '').trim();
    if (!latex) continue;

    let wrappedText;
    if (w.type === 'inline') {
      wrappedText = `${outputDelims.inline.open}${latex}${outputDelims.inline.close}`;
    } else {
      // Base display block
      let displayBlock = `${outputDelims.display.open}\n${latex}\n${outputDelims.display.close}`;

      // If there is non-whitespace text before the display wrapper on this line,
      // insert a newline *before* the block so we get:
      //   text text
      //   $$
      //   formula
      //   $$
      //
      // This applies regardless of language (LaTeX or Markdown) and
      // regardless of which display delimiters are used (\\[...\\] or $$...$$).
      const prefix = (originalLineText || '').slice(0, w.start);
      if (prefix.trim().length > 0) {
        displayBlock = '\n' + displayBlock;
      }

      wrappedText = displayBlock;
    }

    replacements.push({
      start: w.start,
      end: w.end,
      text: wrappedText,
    });
  }

  if (!replacements.length) return;

  isApplyingLazyLatexEdit = true;
  try {
    await editor.edit((editBuilder) => {
      // Optionally insert the original line as a comment above
      if (
        keepOriginalComment &&
        typeof originalLineText === 'string' &&
        originalLineText.trim().length > 0
      ) {
        let commentText;
        if (document.languageId === 'markdown') {
          // HTML-style comment for Markdown
          commentText = `<!-- [lazy-latex input] ${originalLineText} -->`;
        } else {
          // LaTeX-style comment (default)
          commentText = `% [lazy-latex input] ${originalLineText}`;
        }
        const insertPos = new vscode.Position(lineNumber, 0);
        editBuilder.insert(insertPos, commentText + '\n');
      }

      // Apply replacements from right to left so indices remain valid
      const sorted = replacements.sort((a, b) => b.start - a.start);
      for (const r of sorted) {
        const range = new vscode.Range(lineNumber, r.start, lineNumber, r.end);
        editBuilder.replace(range, r.text);
      }
    });
  } finally {
    status.dispose();
    isApplyingLazyLatexEdit = false;
  }
}

/**
 * This function is called when your extension is activated.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  console.log('Lazy LaTeX extension is now active.');

  // Manual command: convert current selection (single expression mode)
  const commandDisposable = vscode.commands.registerCommand(
    'lazy-latex.mathToLatex',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('No active editor.');
        return;
      }

      const selection = editor.selection;

      if (selection.isEmpty) {
        vscode.window.showInformationMessage(
          'Lazy LaTeX: select some math or natural language math text first.'
        );
        return;
      }

      const selectedText = editor.document.getText(selection);

      // Context based on the start line of the selection (previous lines only)
      const contextText = getContextBeforeLine(editor.document, selection.start.line);

      const status = vscode.window.setStatusBarMessage(
        'Lazy LaTeX: generating LaTeX with LLM...'
      );

      let latex;
      try {
        latex = await generateLatexFromText(selectedText, contextText);
      } catch (err) {
        console.error('Lazy LaTeX: LLM error', err);
        vscode.window.showErrorMessage(
          'Lazy LaTeX: failed to generate LaTeX. Check your API key / endpoint and try again.'
        );
        return;
      } finally {
        status.dispose();
      }


      if (!latex) {
        vscode.window.showErrorMessage(
          'Lazy LaTeX: LLM returned empty result.'
        );
        return;
      }

      await editor.edit((editBuilder) => {
        editBuilder.replace(selection, latex);
      });

      // vscode.window.showInformationMessage('Lazy LaTeX: converted selection to LaTeX.');
    }
  );

  context.subscriptions.push(commandDisposable);

  // Auto-processing on Enter
  const changeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if (event.document !== editor.document) return;
    if (isApplyingLazyLatexEdit) return;
    const lang = editor.document.languageId;
    if (lang !== 'latex' && lang !== 'markdown') {
      return;
    }

    // Check autoReplace flag
    const config = vscode.workspace.getConfiguration('lazy-latex');
    const autoReplaceEnabled = config.get('autoReplace', true);
    if (!autoReplaceEnabled) {
      return;
    }

    for (const change of event.contentChanges) {
      if (change.text.includes('\n')) {
        const lineNumber = change.range.start.line; // line just finished
        try {
          const lineText = event.document.lineAt(lineNumber).text;
          const wrappers = findMathWrappersInLine(lineText);

          if (!wrappers.length) {
            console.log(
              '[Lazy LaTeX] Enter on line',
              lineNumber,
              '— no wrappers or comment line.'
            );
          } else {
            console.log(
              '[Lazy LaTeX] Enter on line',
              lineNumber,
              '— found wrappers:',
              wrappers.map((w) => w.type + ':' + w.inner)
            );
            processLineForWrappers(event.document, lineNumber, wrappers).catch(
              (err) => console.error('[Lazy LaTeX] Error processing line:', err)
            );
          }
        } catch (e) {
          console.error('[Lazy LaTeX] Failed to read line after Enter:', e);
        }
      }
    }
  });

  context.subscriptions.push(changeDisposable);
}

function deactivate() { }

module.exports = {
  activate,
  deactivate,
};
