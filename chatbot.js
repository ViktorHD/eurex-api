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
        this.getDatabricksToken = options.getDatabricksToken;
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

        if (!this.geminiSystemPrompt) {
            let schemaSummary = "No schema data available.";
            try {
                if (this.getSchemaSummary) {
                    schemaSummary = await this.getSchemaSummary();
                }
            } catch (e) {
                console.warn("Failed to get schema summary for chatbot context", e);
            }

            this.geminiSystemPrompt = `You are derivatives expert, Eurex T7 functional expert and assistant that answers user questions about Eurex functionality, products and contracts using the Eurex Reference Data GraphQL API.
        
Here is the Eurex GraphQL Schema summary. You MUST use this to understand available queries, fields, and types (e.g. Contracts, Products, TradingHours) to answer the user's questions.

SCHEMA SUMMARY:
${schemaSummary}

Your workflow:
1. Read the Schema Summary above. Never assume which queries or fields exist.
2. If the user's question requires data, use the 'eurex_graphql' tool to execute a query.
3. Answer the user’s question clearly in human words based on the schema and any data retrieved.
4. If a field or query is not in the schema, explain that it’s not available.

Guidelines:
- DO NOT output introspection queries (or any GraphQL queries) to the user unless they explicitly ask for a query.
- Use the 'eurex_graphql' tool to get data needed for your answer.
- You MUST answer the user's questions in human words.
- Always return human-readable answers.
- Use tables or bullet lists if the data is structured.
- Keep answers factual and concise.
- If data has been retrieved using the 'eurex_graphql' tool, it is already displayed in the main application window. DO NOT repeat the data in a table or list within your chat response. Instead, provide a human-readable summary or answer based on that data.
- Always use Product as filter for queries related to Contracts and SettlementPrices.
- If the user explicitly asks for a GraphQL query, ALWAYS wrap it in markdown code blocks like this:
\`\`\`graphql
query {
  ...
}
\`\`\``;
        }

        this.chatHistory.push({
            role: "user",
            parts: [{ text: message }]
        });

        const tools = [{
            functionDeclarations: [{
                name: "eurex_graphql",
                description: "Executes a GraphQL query against the Eurex Reference Data API to retrieve data for the assistant to answer questions.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        query: { type: "STRING" }
                    },
                    required: ["query"]
                }
            }]
        }];

        // Tool execution loop (max 5 turns)
        for (let turn = 0; turn < 5; turn++) {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: this.chatHistory,
                    tools,
                    system_instruction: {
                        parts: [{ text: this.geminiSystemPrompt }]
                    }
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                if (response.status === 429) {
                    throw new Error("Rate limit exceeded (429 Too Many Requests). The Gemini API free tier limits have been reached. Please wait a minute and try again.");
                }
                throw new Error(errorData.error?.message || `Failed to communicate with the Gemini API (${response.status})`);
            }

            const data = await response.json();
            if (!data.candidates || data.candidates.length === 0) {
                throw new Error('No response generated by the model.');
            }

            const candidate = data.candidates[0];
            if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
                if (candidate.finishReason === 'SAFETY') throw new Error('The response was blocked due to safety settings.');
                throw new Error(`The model returned an empty or unsupported response (Reason: ${candidate.finishReason}).`);
            }

            const parts = candidate.content.parts;
            this.chatHistory.push(candidate.content);

            const toolCalls = parts.filter(p => p.functionCall);
            if (toolCalls.length === 0) {
                // Final response
                return parts.map(p => p.text || '').join('\n');
            }

            // Execute tool calls
            const toolResponses = [];
            for (const call of toolCalls) {
                if (call.functionCall.name === 'eurex_graphql') {
                    try {
                        const query = call.functionCall.args.query;
                        const result = await this.onRunQuery(query);
                        toolResponses.push({
                            functionResponse: {
                                name: "eurex_graphql",
                                response: { content: result }
                            }
                        });
                    } catch (err) {
                        toolResponses.push({
                            functionResponse: {
                                name: "eurex_graphql",
                                response: { error: err.message }
                            }
                        });
                    }
                }
            }

            this.chatHistory.push({
                role: "function",
                parts: toolResponses
            });
        }

        throw new Error("Maximum tool execution turns exceeded.");
    }

    async callDatabricksAPI(message) {
        if (this.databricksHistory.length === 0) {
            let schemaSummary = "No schema data available.";
            try {
                if (this.getSchemaSummary) {
                    schemaSummary = await this.getSchemaSummary();
                }
            } catch (e) {
                console.warn("Failed to get schema summary for chatbot context", e);
            }

            this.databricksHistory.push({
                role: 'system',
                content: `You are derivatives expert, Eurex T7 functional expert and assistant that answers user questions about Eurex functionality, products and contracts using the Eurex Reference Data GraphQL API.

SCHEMA SUMMARY:
${schemaSummary}

Your workflow:
1. Read the Schema Summary above. Never assume which queries or fields exist.
2. If the user's question requires data, use the 'eurex_graphql' tool to execute a query.
3. Answer the user's question clearly in human words based on this schema and any data retrieved.
4. If a field or query is not in the schema, explain that it's not available.

Guidelines:
- DO NOT output introspection queries (or any GraphQL queries) to the user unless they explicitly ask for a query.
- Use the 'eurex_graphql' tool to get data needed for your answer.
- You MUST answer the user's questions in human words.
- Always return human-readable answers.
- Keep answers factual and concise.
- If data has been retrieved using the 'eurex_graphql' tool, it is already displayed in the main application window. DO NOT repeat the data in a table or list within your chat response. Instead, provide a human-readable summary or answer based on that data.
- Always use Product as filter for queries related to Contracts and SettlementPrices.
Guidelines:
- Answer the user's questions clearly in human words.
- Keep answers factual and concise.
- Use tables or bullet lists if the data is structured.
- If you provide a GraphQL query, wrap it in markdown code blocks.`
            });
        }

        this.databricksHistory.push({ role: 'user', content: message });

        const tools = [{
            type: "function",
            function: {
                name: "eurex_graphql",
                description: "Executes a GraphQL query against the Eurex Reference Data API to retrieve data for the assistant to answer questions.",
                parameters: {
                    type: "object",
                    properties: {
                        query: { type: "string" }
                    },
                    required: ["query"]
                }
            }
        }];

        for (let turn = 0; turn < 5; turn++) {
            const response = await fetch('/api/databricks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: this.databricksHistory, tools })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                if (response.status === 429) {
                    throw new Error('Rate limit exceeded. Please wait and try again.');
                }
                const detail = errorData.error?.detail || '';
                const msg = errorData.error?.message || `Databricks Agent error (${response.status})`;
                throw new Error(detail ? `${msg} — ${detail}` : msg);
            }

            const data = await response.json();
            let choice = (data.choices && data.choices[0]) || (data.predictions && data.predictions[0]);

            // Normalize Databricks weird response structures
            if (data.dataframe_records && data.dataframe_records[0]) choice = { message: data.dataframe_records[0] };
            if (typeof choice === 'string') choice = { message: { content: choice } };

            const msg = choice?.message || choice;
            if (!msg) throw new Error(`Unexpected response format from Databricks: ${JSON.stringify(data)}`);

            this.databricksHistory.push(msg);

            const toolCalls = msg.tool_calls || [];
            if (toolCalls.length === 0) {
                return msg.content || (typeof msg === 'string' ? msg : JSON.stringify(msg));
            }

            for (const call of toolCalls) {
                if (call.function.name === 'eurex_graphql') {
                    try {
                        const args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments;
                        const result = await this.onRunQuery(args.query);
                        this.databricksHistory.push({
                            role: 'tool',
                            tool_call_id: call.id,
                            name: 'eurex_graphql',
                            content: JSON.stringify(result)
                        });
                    } catch (err) {
                        this.databricksHistory.push({
                            role: 'tool',
                            tool_call_id: call.id,
                            name: 'eurex_graphql',
                            content: err.message
                        });
                    }
                }
            }
        }

        throw new Error("Maximum tool execution turns exceeded.");
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
2. If the user's question requires data, use the 'eurex_graphql' tool to execute a query.
3. Answer the user's question clearly in human words based on this schema and any data retrieved.
4. If a field or query is not in the schema, explain that it's not available.

Guidelines:
- DO NOT output introspection queries (or any GraphQL queries) to the user unless they explicitly ask for a query.
- Use the 'eurex_graphql' tool to get data needed for your answer.
- You MUST answer the user's questions in human words.
- Always return human-readable answers.
- Use tables or bullet lists if the data is structured.
- Keep answers factual and concise.
- If data has been retrieved using the 'eurex_graphql' tool, it is already displayed in the main application window. DO NOT repeat the data in a table or list within your chat response. Instead, provide a human-readable summary or answer based on that data.
- Always use Product as filter for queries related to Contracts and SettlementPrices.
- If the user explicitly asks for a GraphQL query, ALWAYS wrap it in markdown code blocks like this:
\`\`\`graphql
query {
  ...
}
\`\`\``;
        }

        this.claudeHistory.push({ role: 'user', content: message });

        const tools = [{
            name: "eurex_graphql",
            description: "Executes a GraphQL query against the Eurex Reference Data API to retrieve data for the assistant to answer questions.",
            input_schema: {
                type: "object",
                properties: {
                    query: { type: "string" }
                },
                required: ["query"]
            }
        }];

        for (let turn = 0; turn < 5; turn++) {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: 'claude-3-5-sonnet-20240620',
                    max_tokens: 8096,
                    system: this.claudeSystemPrompt,
                    messages: this.claudeHistory,
                    tools
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

            this.claudeHistory.push({ role: 'assistant', content: data.content });

            const toolCalls = data.content.filter(block => block.type === 'tool_use');
            if (toolCalls.length === 0) {
                return data.content.map(block => block.text || '').join('\n');
            }

            const toolResults = [];
            for (const call of toolCalls) {
                if (call.name === 'eurex_graphql') {
                    try {
                        const result = await this.onRunQuery(call.input.query);
                        toolResults.push({
                            type: "tool_result",
                            tool_use_id: call.id,
                            content: JSON.stringify(result)
                        });
                    } catch (err) {
                        toolResults.push({
                            type: "tool_result",
                            tool_use_id: call.id,
                            content: err.message,
                            is_error: true
                        });
                    }
                }
            }

            this.claudeHistory.push({ role: 'user', content: toolResults });
        }


            const toolResults = [];
            for (const call of toolCalls) {
                if (call.name === 'eurex_graphql') {
                    try {
                        const result = await this.onRunQuery(call.input.query);
                        toolResults.push({
                            type: "tool_result",
                            tool_use_id: call.id,
                            content: JSON.stringify(result)
                        });
                    } catch (err) {
                        toolResults.push({
                            type: "tool_result",
                            tool_use_id: call.id,
                            content: err.message,
                            is_error: true
                        });
                    }
                }
            }

            this.claudeHistory.push({ role: 'user', content: toolResults });
        }

        throw new Error("Maximum tool execution turns exceeded.");
    }

    addMessage(role, text) {
        if (typeof text !== 'string') {
            // Handle Claude complex content blocks if necessary
            if (Array.isArray(text)) {
                text = text.filter(b => b.type === 'text').map(b => b.text).join('\n');
            } else {
                text = String(text);
            }
        }

        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${role}`;

        if (role === 'assistant') {
            // Split by markdown code blocks (```...```)
            const parts = text.split(/(```[\s\S]*?```)/g);

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (part.startsWith('```')) {
                    // Code block
                    const content = part.replace(/^```(?:\w+)?\n?/, '').replace(/```$/, '').trim();
                    // More robust GraphQL detection: check for graphql tag OR common GQL keywords at start/structure
                    const isGraphQL = part.includes('graphql') ||
                                     /^\s*(query|mutation|subscription|{)/i.test(content) ||
                                     (content.includes('filter:') && content.includes('{'));
                    const isGraphQL = part.includes('graphql') || content.toLowerCase().includes('query') || content.toLowerCase().includes('{');

                    const pre = document.createElement('pre');
                    const codeEl = document.createElement('code');
                    codeEl.textContent = content;
                    pre.appendChild(codeEl);
                    msgDiv.appendChild(pre);

                    if (isGraphQL) {
                        const runBtn = document.createElement('button');
                        runBtn.className = 'run-query-btn';

                        const iconI = document.createElement('i');
                        iconI.setAttribute('data-feather', 'play');
                        iconI.style.width = '12px';
                        iconI.style.height = '12px';

                        runBtn.appendChild(iconI);
                        runBtn.appendChild(document.createTextNode(' Run this query'));

                        runBtn.onclick = () => {
                            if (this.onRunQuery) {
                                this.onRunQuery(content);
                            }
                        };
                        msgDiv.appendChild(runBtn);
                    }
                } else {
                    // Regular text
                    if (part.trim()) {
                        const lines = part.split('\n');
                        for (let j = 0; j < lines.length; j++) {
                            if (lines[j].trim() === '' && j > 0 && j < lines.length - 1) {
                                msgDiv.appendChild(document.createElement('br'));
                            }
                            msgDiv.appendChild(document.createTextNode(lines[j]));
                            if (j < lines.length - 1) {
                                msgDiv.appendChild(document.createElement('br'));
                            }
                        }
                    }
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
