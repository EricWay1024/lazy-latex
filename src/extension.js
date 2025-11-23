const vscode = require('vscode');
const {
  generateLatexFromText,
  generateLatexForBatch,
  generateAnythingFromInstruction,
} = require('./llmClient');
const { getContextBeforeLine } = require('./context');
const { findWrappersInLine } = require('./wrappers');
const { logLlmError, getFriendlyErrorMessage } = require('./logging');

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

  // Partition wrappers: math vs "anything"
  const mathWrappers = wrappers.filter(
    (w) => w.type === 'inline' || w.type === 'display'
  );
  const anythingWrappers = wrappers.filter((w) => w.type === 'anything');

  const replacements = [];

  // 1) Handle math wrappers via batch call (same as before, but only math)
  if (mathWrappers.length > 0) {
    const mathDescriptions = mathWrappers.map((w) => (w.inner || '').trim());

    let latexList;
    try {
      latexList = await generateLatexForBatch(
        mathDescriptions,
        previousContext,
        originalLineText
      );
    } catch (err) {
      status.dispose();
      console.error('[Lazy LaTeX] Batch LLM error for line', lineNumber, err);
      logLlmError(
        err,
        `Error in auto math conversion on line ${lineNumber}.`
      );
      const msg = getFriendlyErrorMessage(err);
      vscode.window.showErrorMessage(msg);
      // We still allow "anything" wrappers (if any) to proceed
      latexList = [];
    }


    for (let idx = 0; idx < mathWrappers.length; idx++) {
      const w = mathWrappers[idx];
      let latex = (latexList[idx] || '').trim();
      if (!latex) continue;

      // Optional extra replacement to delete trailing punctuation after the wrapper
      let extraReplacement = null;

      if (w.type === 'display' && typeof originalLineText === 'string') {
        const line = originalLineText;
        const len = line.length;
        let i = w.end;

        // Skip whitespace after the wrapper
        while (i < len && /\s/.test(line[i])) {
          i++;
        }

        const punctChars = '.,;:!?';
        if (i < len && punctChars.includes(line[i])) {
          const punctChar = line[i];

          // Move the punctuation inside the display math
          latex = `${latex} ${punctChar}`;

          // And remove the punctuation + any following whitespace,
          // so the next visible text (e.g. "Then we") is flush.
          let j = i + 1;
          while (j < len && /\s/.test(line[j])) {
            j++;
          }

          extraReplacement = {
            start: i,
            end: j,
            text: '',
          };
        }
      }

      let wrappedText;
      if (w.type === 'inline') {
        wrappedText = `${outputDelims.inline.open}${latex}${outputDelims.inline.close}`;
      } else {
        // Display math: ensure it's on its own line if needed
        let displayBlock = `${outputDelims.display.open}\n${latex}\n${outputDelims.display.close}\n`;

        const prefix = (originalLineText || '').slice(0, w.start);
        if (prefix.trim().length > 0) {
          displayBlock = '\n' + displayBlock;
        }

        wrappedText = displayBlock;
      }

      // Replace the wrapper itself
      replacements.push({
        start: w.start,
        end: w.end,
        text: wrappedText,
      });

      // Also delete the punctuation if we found one
      if (extraReplacement) {
        replacements.push(extraReplacement);
      }
    }
  }

  // 2) Handle "anything" wrappers one by one
  if (anythingWrappers.length > 0) {
    for (const w of anythingWrappers) {
      const instruction = (w.inner || '').trim();
      if (!instruction) continue;

      let generated;
      try {
        generated = await generateAnythingFromInstruction(
          instruction,
          previousContext,
          originalLineText,
          document.languageId
        );
      } catch (err) {
        status.dispose();
        console.error(
          '[Lazy LaTeX] LLM error in insert-anything mode on line',
          lineNumber,
          err
        );
        logLlmError(
          err,
          `Error in insert-anything mode (;;;;...;;;;) on line ${lineNumber}.`
        );
        const msg = getFriendlyErrorMessage(err);
        vscode.window.showErrorMessage(msg);
        continue;
      }


      const text = (generated || '').trim();
      if (!text) continue;

      replacements.push({
        start: w.start,
        end: w.end,
        text,
      });
    }
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
        logLlmError(
          err,
          'Error in manual conversion command (Lazy LaTeX: Convert selection to math).'
        );

        const msg = getFriendlyErrorMessage(err);
        vscode.window.showErrorMessage(msg);
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
          const wrappers = findWrappersInLine(lineText, editor.document.languageId);

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
