const vscode = require('vscode');
const { generateLatexFromText } = require('./llmClient');


/**
 * Get context from previous N lines before a given line number.
 * N is read from `lazy-latex.context.lines`.
 *
 * If contextLines = 0, returns an empty string.
 * If contextLines is large, this may include the entire file above the line.
 *
 * @param {vscode.TextDocument} document
 * @param {number} lineNumber
 * @returns {string} joined context lines (may be empty)
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
 * where start/end are character indices in the line (end = index after the closing delimiters).
 */
function findMathWrappersInLine(lineText) {
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
 * Given a document line and the detected wrappers, call the LLM and replace
 * ;;...;; / ;;;...;;; with real LaTeX ($...$ or \[...\]).
 */
async function processLineForWrappers(document, lineNumber, wrappers) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  if (editor.document !== document) return;
  if (!wrappers || wrappers.length === 0) return;

  // Compute context once per line
  const contextText = getContextBeforeLine(document, lineNumber);

  const replacements = [];

  for (const w of wrappers) {
    const trimmed = (w.inner || '').trim();
    if (!trimmed) continue;

    try {
      console.log('[Lazy LaTeX] Generating LaTeX for', w.type, 'wrapper:', trimmed);
      const latex = await generateLatexFromText(trimmed, contextText);
      if (!latex) continue;

      // Wrap depending on inline vs display
      const wrappedText =
        w.type === 'inline'
          ? `$${latex}$`
          : `\\[\n${latex}\n\\]`;

      replacements.push({
        start: w.start,
        end: w.end,
        text: wrappedText,
      });
    } catch (err) {
      console.error('[Lazy LaTeX] Failed to generate LaTeX for wrapper:', w, err);
    }
  }

  if (!replacements.length) return;

  isApplyingLazyLatexEdit = true;
  try {
    await editor.edit((editBuilder) => {
      // Apply from right to left so indices remain valid
      const sorted = replacements.sort((a, b) => b.start - a.start);
      for (const r of sorted) {
        const range = new vscode.Range(lineNumber, r.start, lineNumber, r.end);
        editBuilder.replace(range, r.text);
      }
    });
  } finally {
    isApplyingLazyLatexEdit = false;
  }
}

/**
 * This function is called when your extension is activated.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  console.log('Lazy LaTeX extension is now active.');

  // Manual command: convert current selection
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
      // Context based on the start line of the selection
      const contextText = getContextBeforeLine(editor.document, selection.start.line);


      vscode.window.setStatusBarMessage(
        'Lazy LaTeX: generating LaTeX with LLM...',
        3000
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

      vscode.window.showInformationMessage('Lazy LaTeX: converted selection to LaTeX.');
    }
  );

  context.subscriptions.push(commandDisposable);

  // Auto-processing on Enter
  const changeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if (event.document !== editor.document) return;
    if (isApplyingLazyLatexEdit) return;

    // 🔹 Read the setting each time, so toggling it in Settings works immediately
    const config = vscode.workspace.getConfiguration('lazy-latex');
    const autoReplaceEnabled = config.get('autoReplace', true);
    if (!autoReplaceEnabled) {
      // You can log if you want:
      // console.log('[Lazy LaTeX] autoReplace disabled; ignoring Enter.');
      return;
    }

    for (const change of event.contentChanges) {
      if (change.text.includes('\n')) {
        const lineNumber = change.range.start.line; // line that was just "finished"
        try {
          const lineText = event.document.lineAt(lineNumber).text;
          const wrappers = findMathWrappersInLine(lineText);

          if (!wrappers.length) {
            console.log(
              '[Lazy LaTeX] Enter pressed on line',
              lineNumber,
              '— no wrappers.'
            );
          } else {
            console.log(
              '[Lazy LaTeX] Enter pressed on line',
              lineNumber,
              '— found wrappers:',
              wrappers.map((w) => w.type + ':' + w.inner)
            );
            // Fire-and-forget async processing
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
