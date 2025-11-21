const vscode = require('vscode');

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
 * Call an OpenAI-compatible chat completion endpoint and return the text.
 * This is a low-level helper. We'll build math-specific prompts on top of this.
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
      { role: 'user', content: userPrompt }
    ],
    temperature: 0
  };

  // On modern VS Code (Node >= 18), fetch is available globally.
  // If you later get "fetch is not defined", we can add a polyfill.
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
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
 * For now it only uses the selected text; later we’ll add context.
 *
 * @param {string} selectedText
 * @returns {Promise<string>} LaTeX math expression (no surrounding $)
 */
async function generateLatexFromText(selectedText) {
  const systemPrompt = `
You are an assistant that converts informal or natural language math
(and possibly incorrect LaTeX) into a single valid LaTeX math expression.

Rules:
- Output ONLY the LaTeX math expression itself.
- Do NOT include surrounding $ or $$.
- Do NOT include backticks, explanations, or comments.
- Prefer concise, standard LaTeX math notation.
`.trim();

  const userPrompt = `
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
