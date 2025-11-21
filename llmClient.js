const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { callChatCompletionWithProvider } = require('./llmProvider');

/**
 * Read LLM settings from VS Code config.
 */
function getLlmConfig() {
  const config = vscode.workspace.getConfiguration('lazy-latex');

  const endpoint = config.get('llm.endpoint');
  const apiKey = config.get('llm.apiKey');
  const model = config.get('llm.model');
  const provider = config.get('llm.provider', 'openai');

  return { endpoint, apiKey, model, provider };
}


/**
 * Read:
 * - extra instructions from settings (lazy-latex.prompt.extra)
 * - extra instructions from workspace file .lazy-latex.md (if present)
 *
 * We return both and tell the model that the file has higher priority.
 *
 * @returns {Promise<{ fileExtra: string, settingExtra: string }>}
 */
async function getExtraInstructionsSources() {
  const config = vscode.workspace.getConfiguration('lazy-latex');
  const settingExtraRaw = config.get('prompt.extra') || '';
  const settingExtra =
    typeof settingExtraRaw === 'string' ? settingExtraRaw.trim() : '';

  let fileExtra = '';

  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    const workspaceRoot = folders[0].uri.fsPath;
    const promptFilePath = path.join(workspaceRoot, '.lazy-latex.md');

    try {
      await fs.promises.access(promptFilePath, fs.constants.R_OK);
      const content = await fs.promises.readFile(promptFilePath, 'utf8');
      fileExtra = content.trim();
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.error('[Lazy LaTeX] Failed to read .lazy-latex.md:', err);
      }
    }
  }

  return { fileExtra, settingExtra };
}

/**
 * Call an OpenAI-compatible chat completion endpoint and return the text.
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>}
 */
async function callChatCompletion(systemPrompt, userPrompt) {
  const { endpoint, apiKey, model, provider } = getLlmConfig();

  return callChatCompletionWithProvider({
    provider,
    endpoint,
    apiKey,
    model,
    systemPrompt,
    userPrompt,
  });
}

/**
 * Single expression mode: convert one informal / natural language math snippet
 * into a single LaTeX math expression.
 *
 * Uses:
 * - base system rules
 * - .lazy-latex.md (HIGH PRIORITY, if present)
 * - lazy-latex.prompt.extra (LOWER PRIORITY)
 * - optional contextText (recent lines, etc.)
 *
 * @param {string} selectedText
 * @param {string} [contextText]
 * @returns {Promise<string>} LaTeX math expression (no surrounding $)
 */
async function generateLatexFromText(selectedText, contextText) {
  const { fileExtra, settingExtra } = await getExtraInstructionsSources();

  let systemPrompt = `
You are an assistant that converts informal or natural language math
(and possibly incorrect LaTeX) into a single valid LaTeX math expression.

Rules:
- Output ONLY the LaTeX math expression itself.
- Do NOT include surrounding $ or $$.
- Do NOT include backticks, explanations, or comments.
- Prefer concise, standard LaTeX math notation.
`.trim();

  // Attach both sources of extra instructions, with explicit priority.
  if (fileExtra || settingExtra) {
    systemPrompt += '\n\nAdditional instructions follow.\n';

    if (fileExtra) {
      systemPrompt += `\nHIGH PRIORITY from project settings:\n${fileExtra}\n`;
    }

    if (settingExtra) {
      systemPrompt += `\nLOWER PRIORITY from user settings:\n${settingExtra}\n`;
    }

    systemPrompt = systemPrompt.trimEnd();
  }

  let contextBlock = '';
  if (contextText && typeof contextText === 'string' && contextText.trim().length > 0) {
    contextBlock = `
The following is context from the recent lines of the current LaTeX document.
Use it to interpret notation and meaning, but do not rewrite it. It may contain
definitions, assumptions, or earlier formulas.

Context:
"""
${contextText}
"""
`.trim();
  }

  const userPrompt = `
${contextBlock ? contextBlock + '\n\n' : ''}
Convert the following text into a single LaTeX math expression.

Text:
"""
${selectedText}
"""
`.trim();

  const result = await callChatCompletion(systemPrompt, userPrompt);
  return result;
}

/**
 * Batch mode: convert multiple informal / natural language math snippets
 * on the same line into LaTeX, keeping them consistent.
 *
 * The model sees:
 * - previous lines context (if any)
 * - the FULL current line (raw, with wrappers)
 * - a numbered list of descriptions for each wrapper
 *
 * It must output exactly N lines, each containing ONLY the LaTeX expression
 * for the corresponding description.
 *
 * @param {string[]} descriptions  inner texts of wrappers, in order
 * @param {string} [previousContextText]  previous lines context
 * @param {string} [rawCurrentLine]       full current line, with wrappers
 * @returns {Promise<string[]>} array of LaTeX expressions (same length as descriptions, empty string if missing)
 */
async function generateLatexForBatch(descriptions, previousContextText, rawCurrentLine) {
  const { fileExtra, settingExtra } = await getExtraInstructionsSources();

  let systemPrompt = `
You are an assistant that converts informal or natural language math
(and possibly incorrect LaTeX) into valid LaTeX math expressions.

Rules:
- For each description, produce ONE LaTeX math expression.
- Do NOT include surrounding $ or $$.
- Do NOT include backticks, explanations, or comments.
- Prefer concise, standard LaTeX math notation.
- When multiple descriptions refer to the same objects (e.g., vectors u, v),
  keep notation and style consistent across them.
`.trim();

  if (fileExtra || settingExtra) {
    systemPrompt += '\n\nAdditional instructions follow.\n';

    if (fileExtra) {
      systemPrompt += `\nHIGH PRIORITY from project settings:\n${fileExtra}\n`;
    }

    if (settingExtra) {
      systemPrompt += `\nLOWER PRIORITY from user settings:\n${settingExtra}\n`;
    }

    systemPrompt = systemPrompt.trimEnd();
  }

  let contextParts = [];

  if (previousContextText && previousContextText.trim().length > 0) {
    contextParts.push(
      `Previous lines from the current LaTeX document:\n"""` +
        `\n${previousContextText}\n"""`
    );
  }

  if (rawCurrentLine && rawCurrentLine.trim().length > 0) {
    contextParts.push(
      `Current line (raw, with wrappers):\n"""` +
        `\n${rawCurrentLine}\n"""`
    );
  }

  const contextBlock = contextParts.length
    ? `The following is context from the current LaTeX document.\n` +
      `Use it to interpret notation and meaning, but do not rewrite it.\n\n` +
      contextParts.join('\n\n')
    : '';

  const numberedDescriptions = descriptions
    .map((desc, idx) => `${idx + 1}) ${desc}`)
    .join('\n');

  const userPrompt = `
${contextBlock ? contextBlock + '\n\n' : ''}
You will be given ${descriptions.length} informal or natural language math descriptions
taken from wrappers on the same line of a LaTeX document.

Convert EACH description into a single LaTeX math expression.

Descriptions:
${numberedDescriptions}

Output exactly ${descriptions.length} lines.
Line i must contain ONLY the LaTeX math expression for description i.
Do NOT include numbering, labels, comments, or explanations.
`.trim();

  const result = await callChatCompletion(systemPrompt, userPrompt);

  const lines = result
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const outputs = [];
  for (let i = 0; i < descriptions.length; i++) {
    outputs.push(lines[i] || '');
  }
  return outputs;
}

module.exports = {
  generateLatexFromText,
  generateLatexForBatch,
};
