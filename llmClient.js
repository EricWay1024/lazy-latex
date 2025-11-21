const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/**
 * Read LLM settings from VS Code config.
 */
function getLlmConfig() {
  const config = vscode.workspace.getConfiguration('lazy-latex');

  const endpoint = config.get('llm.endpoint');
  const apiKey = config.get('llm.apiKey');
  const model = config.get('llm.model');

  return { endpoint, apiKey, model };
}

/**
 * Read:
 * - extra instructions from settings (lazy-latex.prompt.extra)
 * - extra instructions from workspace file .lazy-latex.md (if present)
 *
 * We DON'T choose one or the other here — we return both,
 * and the prompt will state that the MD file has higher priority.
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
      // It's fine if the file doesn't exist; we just skip it.
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
  const { endpoint, apiKey, model } = getLlmConfig();

  if (!apiKey) {
    vscode.window.showErrorMessage(
      'Lazy LaTeX: No API key set. Please configure "lazy-latex.llm.apiKey" in Settings.'
    );
    throw new Error('Missing API key');
  }

  if (!endpoint || !model) {
    vscode.window.showErrorMessage(
      'Lazy LaTeX: LLM endpoint or model is not configured.'
    );
    throw new Error('Missing endpoint or model');
  }

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error('LLM HTTP error:', response.status, text);
    throw new Error(`LLM request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  const content =
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;

  if (!content || typeof content !== 'string') {
    console.error('Unexpected LLM response shape:', data);
    throw new Error('LLM response did not contain text content');
  }

  return content.trim();
}

/**
 * Higher-level helper: convert informal / natural language math into LaTeX.
 * Uses:
 * - base system rules
 * - .lazy-latex.md (HIGH PRIORITY, if present)
 * - lazy-latex.prompt.extra (lower priority)
 * - optional contextText (recent lines from the document)
 *
 * @param {string} selectedText
 * @param {string} [contextText]  // optional
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

module.exports = {
  generateLatexFromText,
};
