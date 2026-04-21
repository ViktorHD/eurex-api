export class Chatbot {
    constructor(options) {
        this.container = options.container;
        this.window = options.window;
        this.messagesContainer = options.messagesContainer;
        this.input = options.input;
        this.sendBtn = options.sendBtn;
        this.toggleBtn = options.toggleBtn;
        this.closeBtn = options.closeBtn;
        this.getApiKey = options.getApiKey;
        this.getClaudeApiKey = options.getClaudeApiKey;
        this.getProvider = options.getProvider;
        this.getSchemaSummary = options.getSchemaSummary;
        this.onRunQuery = options.onRunQuery;

        this.chatHistory = [];
        this.claudeHistory = [];
        this.claudeSystemPrompt = null;
        this.databricksHistory = [];
        this.bindEvents();
    }

    bindEvents() {
        this.toggleBtn.addEventListener('click', () => this.toggleWindow());
        this.closeBtn.addEventListener('click', () => this.toggleWindow(false));

        this.sendBtn.addEventListener('click', () => this.handleSend());

        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSend();
            }
        });
    }

    toggleWindow(force) {
        if (typeof force === 'boolean') {
            if (force) {
                this.window.classList.remove('hidden');
            } else {
                this.window.classList.add('hidden');
            }
        } else {
            this.window.classList.toggle('hidden');
        }

        if (!this.window.classList.contains('hidden')) {
            this.input.focus();
        }
    }

    async handleSend() {
        const text = this.input.value.trim();
        if (!text) return;

        const provider = this.getProvider ? this.getProvider() : 'gemini';

        let apiKey = '';
        if (provider === 'claude') {
            apiKey = this.getClaudeApiKey ? this.getClaudeApiKey() : '';
            if (!apiKey) {
                this.addMessage('assistant', 'Please enter your Claude API key in the "Headers & Variables" drawer to use the chatbot.');
                return;
            }
        } else if (provider === 'gemini') {
            apiKey = this.getApiKey();
            if (!apiKey) {
                this.addMessage('assistant', 'Please enter your Google Gemini API key in the "Headers & Variables" drawer to use the chatbot.');
                return;
            }
        }

        this.input.value = '';
        this.addMessage('user', text);

        const loadingId = this.addLoadingIndicator();
        this.scrollToBottom();

        try {
            let response;
            if (provider === 'claude') {
                response = await this.callClaudeAPI(text, apiKey);
            } else if (provider === 'databricks') {
                response = await this.callDatabricksAPI(text);
            } else {
                response = await this.callGeminiAPI(text, apiKey);
            }
            this.removeMessage(loadingId);
            this.addMessage('assistant', response);
        } catch (error) {
            this.removeMessage(loadingId);
            this.addMessage('assistant', `Error: ${error.message}`);
        }
    }

    async callGeminiAPI(message, apiKey) {
        const modelName = "models/gemini-2.5-flash";
        const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`;

        // Initialize history with system prompt if empty
        if (this.chatHistory.length === 0) {
            let schemaSummary = "No schema data available.";
            try {
                if (this.getSchemaSummary) {
                    schemaSummary = await this.getSchemaSummary();
                }
            } catch (e) {
                console.warn("Failed to get schema summary for chatbot context", e);
            }

            const systemPrompt = `You are derivatives expert, Eurex T7 functional expert and assistant that answers user questions about Eurex functionality, products and contracts using the Eurex Reference Data GraphQL API.
        
Here is the Eurex GraphQL Schema summary. You MUST use this to understand available queries, fields, and types (e.g. Contracts, Products, TradingHours) to answer the user's questions.

SCHEMA SUMMARY:
${schemaSummary}

Your workflow:
1. Read the Schema Summary above. Never assume which queries or fields exist.
2. Answer the user’s question clearly in human words based on this schema.
3. If a field or query is not in the schema, explain that it’s not available.

Guidelines:
- DO NOT output introspection queries (or any GraphQL queries) to the user unless they explicitly ask for a query. 
- You MUST answer the user's questions in human words.
- Always return human-readable answers.
- Use tables or bullet lists if the data is structured.
- Keep answers factual and concise.
- Retrieved results should be presented in a table format.
- Always use Product as filter for queries related to Contracts and SettlementPrices.
- If the user explicitly asks for a GraphQL query, ALWAYS wrap it in markdown code blocks like this:
\`\`\`graphql
query {
  ...
}
\`\`\``;

            this.chatHistory.push({
                role: "user",
                parts: [{ text: systemPrompt }]
            });
            this.chatHistory.push({
                role: "model",
                parts: [{ text: "Understood. I am ready to help with the Eurex GraphQL API." }]
            });
        }

        this.chatHistory.push({
            role: "user",
            parts: [{ text: message }]
        });

        const requestBody = {
            contents: this.chatHistory,
            tools: [{
                functionDeclarations: [{
                    name: "eurex_graphql",
                    description: "Executes a GraphQL query against the Eurex Reference Data API.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            query: { type: "STRING" }
                        },
                        required: ["query"]
                    }
                }]
            }]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            if (response.status === 429) {
                throw new Error("Rate limit exceeded (429 Too Many Requests). The Gemini API free tier limits have been reached. Please wait a minute and try again.");
            }
            throw new Error(errorData.error?.message || `Failed to communicate with the Gemini API (${response.status})`);
        }

        const data = await response.json();

        if (data.candidates && data.candidates.length > 0) {
            const candidate = data.candidates[0];

            // Handle cases where the model response is blocked or empty
            if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
                console.error("Unexpected or blocked response:", data);
                if (candidate.finishReason === 'SAFETY') {
                    throw new Error('The response was blocked due to safety settings.');
                }
                const reason = candidate.finishReason ? `(Reason: ${candidate.finishReason})` : '';
                throw new Error(`The model returned an empty or unsupported response ${reason}. Check console for details.`);
            }

            const part = candidate.content.parts[0];
            let replyText = part.text || '';
            if (part.functionCall && part.functionCall.name === 'eurex_graphql') {
                replyText = `I have formulated a query based on your request. Please run it:\n\`\`\`graphql\n${part.functionCall.args.query}\n\`\`\``;
            }
            if (!replyText) replyText = '(The model generated an empty response)';

            // Save model reply to history
            this.chatHistory.push({
                role: "model",
                parts: [{ text: replyText }]
            });

            return replyText;
        } else {
            throw new Error('No response generated by the model.');
        }
    }

    async callDatabricksAPI(message) {
        const url = '/api/databricks';

        this.databricksHistory.push({ role: 'user', content: message });

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: this.databricksHistory })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            if (response.status === 429) {
                throw new Error('Rate limit exceeded. Please wait and try again.');
            }
            throw new Error(errorData.error?.message || `Databricks Agent error (${response.status})`);
        }

        const data = await response.json();

        let replyText = '';
        if (data.choices && data.choices.length > 0) {
            replyText = data.choices[0].message?.content || data.choices[0].text || '';
        } else if (typeof data.content === 'string') {
            replyText = data.content;
        } else if (typeof data === 'string') {
            replyText = data;
        }

        if (!replyText) throw new Error('No response generated by the agent.');

        this.databricksHistory.push({ role: 'assistant', content: replyText });
        return replyText;
    }

    async callClaudeAPI(message, apiKey) {
        if (!this.claudeSystemPrompt) {
            let schemaSummary = "No schema data available.";
            try {
                if (this.getSchemaSummary) {
                    schemaSummary = await this.getSchemaSummary();
                }
            } catch (e) {
                console.warn("Failed to get schema summary for chatbot context", e);
            }

            this.claudeSystemPrompt = `You are a derivatives expert, Eurex T7 functional expert and assistant that answers user questions about Eurex functionality, products and contracts using the Eurex Reference Data GraphQL API.

Here is the Eurex GraphQL Schema summary. You MUST use this to understand available queries, fields, and types (e.g. Contracts, Products, TradingHours) to answer the user's questions.

SCHEMA SUMMARY:
${schemaSummary}

Your workflow:
1. Read the Schema Summary above. Never assume which queries or fields exist.
2. Answer the user's question clearly in human words based on this schema.
3. If a field or query is not in the schema, explain that it's not available.

Guidelines:
- DO NOT output introspection queries (or any GraphQL queries) to the user unless they explicitly ask for a query.
- You MUST answer the user's questions in human words.
- Always return human-readable answers.
- Use tables or bullet lists if the data is structured.
- Keep answers factual and concise.
- Retrieved results should be presented in a table format.
- Always use Product as filter for queries related to Contracts and SettlementPrices.
- If the user explicitly asks for a GraphQL query, ALWAYS wrap it in markdown code blocks like this:
\`\`\`graphql
query {
  ...
}
\`\`\``;
        }

        this.claudeHistory.push({ role: 'user', content: message });

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 8096,
                system: this.claudeSystemPrompt,
                messages: this.claudeHistory
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            if (response.status === 429) {
                throw new Error("Rate limit exceeded (429 Too Many Requests). Please wait and try again.");
            }
            throw new Error(errorData.error?.message || `Failed to communicate with the Claude API (${response.status})`);
        }

        const data = await response.json();

        if (!data.content || data.content.length === 0) {
            throw new Error('No response generated by the model.');
        }

        const replyText = data.content[0].text;
        this.claudeHistory.push({ role: 'assistant', content: replyText });

        return replyText;
    }

    addMessage(role, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${role}`;

        if (role === 'assistant') {
            // Very simple markdown parsing for code blocks using regex
            // Split by ```graphql ... ``` or ``` ... ```
            const parts = text.split(/```(?:graphql)?\n([\s\S]*?)```/g);

            for (let i = 0; i < parts.length; i++) {
                if (i % 2 === 0) {
                    // Regular text
                    if (parts[i].trim()) {
                        // Convert newlines to br
                        const lines = parts[i].split('\n');
                        for (let j = 0; j < lines.length; j++) {
                            msgDiv.appendChild(document.createTextNode(lines[j]));
                            if (j < lines.length - 1) {
                                msgDiv.appendChild(document.createElement('br'));
                            }
                        }
                    }
                } else {
                    // Code block
                    const pre = document.createElement('pre');
                    const codeEl = document.createElement('code');
                    codeEl.textContent = parts[i].trim();
                    pre.appendChild(codeEl);
                    msgDiv.appendChild(pre);

                    const runBtn = document.createElement('button');
                    runBtn.className = 'run-query-btn';

                    // Add feather icon placeholder
                    const iconI = document.createElement('i');
                    iconI.setAttribute('data-feather', 'play');
                    iconI.style.width = '12px';
                    iconI.style.height = '12px';

                    runBtn.appendChild(iconI);
                    runBtn.appendChild(document.createTextNode(' Run this query'));

                    runBtn.onclick = () => {
                        if (this.onRunQuery) {
                            this.onRunQuery(parts[i].trim());
                        }
                    };
                    msgDiv.appendChild(runBtn);
                }
            }

        } else {
            // User message, plain text
            msgDiv.textContent = text;
        }

        this.messagesContainer.appendChild(msgDiv);

        if (window.feather) {
            window.feather.replace();
        }

        this.scrollToBottom();
    }

    addLoadingIndicator() {
        const id = 'loading-' + Date.now();
        const msgDiv = document.createElement('div');
        msgDiv.id = id;
        msgDiv.className = 'chatbot-loading';
        msgDiv.innerHTML = `
            <div class="chatbot-loading-dot"></div>
            <div class="chatbot-loading-dot"></div>
            <div class="chatbot-loading-dot"></div>
        `;
        this.messagesContainer.appendChild(msgDiv);
        this.scrollToBottom();
        return id;
    }

    removeMessage(id) {
        const el = document.getElementById(id);
        if (el) {
            el.remove();
        }
    }

    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
}
