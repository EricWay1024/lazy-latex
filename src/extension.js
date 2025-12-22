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
// Guard to prevent infinite loops when saving after processing wrappers
let isProcessingSave = false;

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

      // Check for space + single semicolon after wrapper (user's actual punctuation)
      // Pattern: wrapper + space + ; (where ; is not part of another wrapper)
      let spaceBeforeSemicolonReplacement = null;
      if (typeof originalLineText === 'string') {
        const line = originalLineText;
        const len = line.length;
        let i = w.end;

        // Skip whitespace after the wrapper
        let spaceStart = i;
        while (i < len && /\s/.test(line[i])) {
          i++;
        }

        // Check if we have exactly one semicolon (not part of ;;, ;;;, or ;;;;)
        if (i < len && line[i] === ';') {
          // Check if it's just a single semicolon (not followed by another semicolon)
          if (i + 1 >= len || line[i + 1] !== ';') {
            // This is the pattern: wrapper + space(s) + single semicolon
            // Remove the space(s) but keep the semicolon
            if (i > spaceStart) {
              spaceBeforeSemicolonReplacement = {
                start: spaceStart,
                end: i, // Remove up to (but not including) the semicolon
                text: '',
              };
            }
          }
        }
      }

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

      // Remove space before single semicolon if found
      if (spaceBeforeSemicolonReplacement) {
        replacements.push(spaceBeforeSemicolonReplacement);
      }

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

      // Check for space + single semicolon after wrapper (user's actual punctuation)
      let spaceBeforeSemicolonReplacement = null;
      if (typeof originalLineText === 'string') {
        const line = originalLineText;
        const len = line.length;
        let i = w.end;

        // Skip whitespace after the wrapper
        let spaceStart = i;
        while (i < len && /\s/.test(line[i])) {
          i++;
        }

        // Check if we have exactly one semicolon (not part of ;;, ;;;, or ;;;;)
        if (i < len && line[i] === ';') {
          // Check if it's just a single semicolon (not followed by another semicolon)
          if (i + 1 >= len || line[i + 1] !== ';') {
            // This is the pattern: wrapper + space(s) + single semicolon
            // Remove the space(s) but keep the semicolon
            if (i > spaceStart) {
              spaceBeforeSemicolonReplacement = {
                start: spaceStart,
                end: i, // Remove up to (but not including) the semicolon
                text: '',
              };
            }
          }
        }
      }

      replacements.push({
        start: w.start,
        end: w.end,
        text,
      });

      // Remove space before single semicolon if found
      if (spaceBeforeSemicolonReplacement) {
        replacements.push(spaceBeforeSemicolonReplacement);
      }
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
 * Process all lines with wrappers in a document.
 * Uses multiple passes to handle line number shifts when display math is inserted.
 * 
 * @param {vscode.TextDocument} document
 * @returns {Promise<boolean>} True if any conversions were made, false otherwise
 */
async function processAllWrappersInDocument(document) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document !== document) {
    return false;
  }

  const lang = document.languageId;
  if (lang !== 'latex' && lang !== 'markdown') {
    return false;
  }

  let anyConversions = false;
  const maxPasses = 10; // Prevent infinite loops
  let pass = 0;

  // Use multiple passes to handle cases where processing one line
  // changes the document structure (e.g., display math adds newlines)
  while (pass < maxPasses) {
    pass++;
    let foundWrappers = false;
    const lineCount = document.lineCount;

    // Process lines from top to bottom
    // This ensures context includes already-converted lines above
    for (let lineNumber = 0; lineNumber < lineCount; lineNumber++) {
      try {
        // Re-read line in case document changed
        const lineText = document.lineAt(lineNumber).text;
        const wrappers = findWrappersInLine(lineText, lang);

        if (wrappers.length > 0) {
          foundWrappers = true;
          await processLineForWrappers(document, lineNumber, wrappers);
          anyConversions = true;
          
          // After processing, the document structure may have changed
          // Break and do another pass to catch any remaining wrappers
          break;
        }
      } catch (e) {
        console.error(`[Lazy LaTeX] Error processing line ${lineNumber}:`, e);
        // Continue with next line
      }
    }

    // If no wrappers were found in this pass, we're done
    if (!foundWrappers) {
      break;
    }
  }

  if (pass >= maxPasses) {
    console.warn('[Lazy LaTeX] Reached max passes while processing document wrappers.');
  }

  return anyConversions;
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

  // Command: convert wrappers on current line
  const convertCurrentLineDisposable = vscode.commands.registerCommand(
    'lazy-latex.convertCurrentLine',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('No active editor.');
        return;
      }

      const document = editor.document;
      const lang = document.languageId;
      
      // Only work in LaTeX and Markdown files
      if (lang !== 'latex' && lang !== 'markdown') {
        vscode.window.showInformationMessage(
          'Lazy LaTeX: This command only works in LaTeX or Markdown files.'
        );
        return;
      }

      // Get the current line number
      const lineNumber = editor.selection.active.line;
      
      try {
        const lineText = document.lineAt(lineNumber).text;
        const wrappers = findWrappersInLine(lineText, lang);

        if (!wrappers.length) {
          vscode.window.showInformationMessage(
            'Lazy LaTeX: No wrappers found on the current line.'
          );
          return;
        }

        console.log(
          '[Lazy LaTeX] Convert current line command on line',
          lineNumber,
          '— found wrappers:',
          wrappers.map((w) => w.type + ':' + w.inner)
        );

        await processLineForWrappers(document, lineNumber, wrappers);
      } catch (e) {
        console.error('[Lazy LaTeX] Failed to process current line:', e);
        vscode.window.showErrorMessage(
          'Lazy LaTeX: Failed to process current line. See output for details.'
        );
      }
    }
  );

  context.subscriptions.push(convertCurrentLineDisposable);

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

  // Auto-processing on save (if enabled)
  // Mode 1: convert-save (convert before save happens)
  const willSaveDisposable = vscode.workspace.onWillSaveTextDocument(async (event) => {
    const document = event.document;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) return;
    if (isApplyingLazyLatexEdit) return;
    if (isProcessingSave) return; // Prevent infinite loops

    const lang = document.languageId;
    if (lang !== 'latex' && lang !== 'markdown') {
      return;
    }

    // Check convertOnSave mode
    const config = vscode.workspace.getConfiguration('lazy-latex');
    const convertOnSaveMode = config.get('convertOnSave', 'none');
    if (convertOnSaveMode !== 'convert-save') {
      return;
    }

    isProcessingSave = true;
    console.log('[Lazy LaTeX] Will save: converting wrappers before save...');

    // Wait for the conversion to complete before allowing save to proceed
    const conversionPromise = (async () => {
      try {
        const hadConversions = await processAllWrappersInDocument(document);
        if (hadConversions) {
          console.log('[Lazy LaTeX] Wrappers converted, save will proceed.');
        } else {
          console.log('[Lazy LaTeX] No wrappers found in document.');
        }
      } catch (err) {
        console.error('[Lazy LaTeX] Error processing wrappers before save:', err);
        vscode.window.showErrorMessage(
          'Lazy LaTeX: Error processing wrappers before save. See output for details.'
        );
      } finally {
        isProcessingSave = false;
      }
    })();
    
    event.waitUntil(conversionPromise);
  });

  context.subscriptions.push(willSaveDisposable);

  // Mode 2: save-convert-save (save first, then convert, then save again)
  const didSaveDisposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) return;
    if (isApplyingLazyLatexEdit) return;
    if (isProcessingSave) return; // Prevent infinite loops

    const lang = document.languageId;
    if (lang !== 'latex' && lang !== 'markdown') {
      return;
    }

    // Check convertOnSave mode
    const config = vscode.workspace.getConfiguration('lazy-latex');
    const convertOnSaveMode = config.get('convertOnSave', 'none');
    if (convertOnSaveMode !== 'save-convert-save') {
      return;
    }

    isProcessingSave = true;
    console.log('[Lazy LaTeX] Save detected, processing all wrappers in document...');

    try {
      const hadConversions = await processAllWrappersInDocument(document);
      
      if (hadConversions) {
        // Save again after conversions
        await document.save();
        console.log('[Lazy LaTeX] Document saved again after wrapper conversions.');
      } else {
        console.log('[Lazy LaTeX] No wrappers found in document.');
      }
    } catch (err) {
      console.error('[Lazy LaTeX] Error processing wrappers on save:', err);
      vscode.window.showErrorMessage(
        'Lazy LaTeX: Error processing wrappers on save. See output for details.'
      );
    } finally {
      isProcessingSave = false;
    }
  });

  context.subscriptions.push(didSaveDisposable);
}

function deactivate() { }

module.exports = {
  activate,
  deactivate,
};
