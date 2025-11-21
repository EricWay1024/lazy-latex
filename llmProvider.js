// llmProvider.js
const vscode = require('vscode');

/**
 * Low-level LLM call wrapper.
 *
 * Currently only supports OpenAI-compatible chat completion APIs:
 *   POST endpoint
 *   { model, messages: [{role, content}, ...], temperature }
 *
 * Later we can branch on `provider` to support Anthropic, Gemini, etc.
 *
 * @param {Object} options
 * @param {string} options.provider     e.g. 'openai' (for future use)
 * @param {string} options.endpoint
 * @param {string} options.apiKey
 * @param {string} options.model
 * @param {string} options.systemPrompt
 * @param {string} options.userPrompt
 * @returns {Promise<string>} assistant message content
 */
async function callChatCompletionWithProvider({
  provider,
  endpoint,
  apiKey,
  model,
  systemPrompt,
  userPrompt,
}) {
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

  // Normalize provider
  const p = (provider || 'openai').toLowerCase();

  // --- OpenAI-compatible branch (default) ---
    if (p === 'openai' || p === 'gemini') {
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
      console.error(`LLM HTTP error (${p}):`, response.status, text);
      throw new Error(
        `LLM request failed (${p}): ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    const content =
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;

    if (!content || typeof content !== 'string') {
      console.error('Unexpected OpenAI-compatible response shape:', data);
      throw new Error('LLM response did not contain text content');
    }

    return content.trim();
  }
  
  // --- Anthropic / Claude branch ---
  if (p === 'anthropic') {
    // Expect endpoint like: https://api.anthropic.com/v1/messages
    // apiKey = Anthropic API key
    const body = {
      model,
      max_tokens: 512, // adjust if you need longer outputs
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('LLM HTTP error (anthropic):', response.status, text);
      throw new Error(
        `LLM request failed (anthropic): ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    let content = '';
    if (Array.isArray(data.content) && data.content.length > 0) {
      const first = data.content[0];
      if (first && first.type === 'text' && typeof first.text === 'string') {
        content = first.text;
      }
    }

    if (!content || typeof content !== 'string') {
      console.error('Unexpected Anthropic response shape:', data);
      throw new Error('LLM response did not contain text content');
    }

    return content.trim();
  }

  // --- Fallback for unknown provider ---
  vscode.window.showErrorMessage(
    `Lazy LaTeX: Unsupported LLM provider "${provider}".`
  );
  throw new Error(`Unsupported LLM provider: ${provider}`);
}

module.exports = {
  callChatCompletionWithProvider,
};
