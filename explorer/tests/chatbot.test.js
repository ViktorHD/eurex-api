/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { Chatbot, OPENROUTER_URL, DEFAULT_OPENROUTER_MODEL } from '../chatbot.js';

function setup(provider, extra = {}) {
    document.body.innerHTML = `<div id="w"></div><div id="m"></div><textarea id="i"></textarea><button id="s"></button><button id="t"></button><button id="c"></button>`;
    const bot = new Chatbot({
        container: document.body, window: document.getElementById('w'), messagesContainer: document.getElementById('m'),
        input: document.getElementById('i'), sendBtn: document.getElementById('s'), toggleBtn: document.getElementById('t'),
        closeBtn: document.getElementById('c'), getProvider: () => provider,
        getOpenRouterKey: () => 'or-key', getOpenRouterModel: () => 'meta/some:free',
        getSchemaSummary: async () => 'type Query {}', getVariables: () => '', onRunQuery: jest.fn(), ...extra
    });
    bot.input.value = 'hello';
    return bot;
}

const reply = (message) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message }] }) });
const lastMessage = () => document.getElementById('m').lastElementChild.textContent;

afterEach(() => { delete global.fetch; });

describe('OpenRouter provider', () => {
    test('calls OpenRouter directly with the user key and chosen model', async () => {
        global.fetch = jest.fn().mockResolvedValue(reply({ role: 'assistant', content: 'hi there' }));
        const bot = setup('openrouter');
        await bot.handleSend();
        const [url, options] = global.fetch.mock.calls[0];
        expect(url).toBe(OPENROUTER_URL);
        expect(options.headers.Authorization).toBe('Bearer or-key');
        const body = JSON.parse(options.body);
        expect(body.model).toBe('meta/some:free');
        expect(body.tools[0].function.name).toBe('eurex_graphql');
        expect(lastMessage()).toBe('hi there');
    });

    test('falls back to the default model', async () => {
        global.fetch = jest.fn().mockResolvedValue(reply({ role: 'assistant', content: 'ok' }));
        const bot = setup('openrouter', { getOpenRouterModel: () => '' });
        await bot.handleSend();
        expect(JSON.parse(global.fetch.mock.calls[0][1].body).model).toBe(DEFAULT_OPENROUTER_MODEL);
    });

    test('asks for a key instead of calling out', async () => {
        global.fetch = jest.fn();
        const bot = setup('openrouter', { getOpenRouterKey: () => '' });
        await bot.handleSend();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(lastMessage()).toMatch(/OpenRouter API key/);
    });

    test('runs tool calls and sends the result back', async () => {
        const call = { id: 'c1', type: 'function', function: { name: 'eurex_graphql', arguments: '{"query":"{ a }"}' } };
        global.fetch = jest.fn()
            .mockResolvedValueOnce(reply({ role: 'assistant', content: null, tool_calls: [call] }))
            .mockResolvedValueOnce(reply({ role: 'assistant', content: 'done' }));
        const onRunQuery = jest.fn().mockResolvedValue([{ a: 1 }]);
        const bot = setup('openrouter', { onRunQuery });
        await bot.handleSend();
        expect(onRunQuery).toHaveBeenCalledWith('{ a }', null);
        const second = JSON.parse(global.fetch.mock.calls[1][1].body).messages;
        expect(second[second.length - 1]).toMatchObject({ role: 'tool', tool_call_id: 'c1', content: '[{"a":1}]' });
        expect(lastMessage()).toBe('done');
    });

    test('shows the provider error message', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: 'No auth credentials found' } }) });
        const bot = setup('openrouter');
        await bot.handleSend();
        expect(lastMessage()).toBe('Error: No auth credentials found');
    });

    test('an error object with HTTP 200 is reported', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ error: { message: 'provider down' } }) });
        const bot = setup('openrouter');
        await bot.handleSend();
        expect(lastMessage()).toBe('Error: OpenRouter: provider down');
    });
});

describe('built-in provider', () => {
    test('uses the same-origin proxy without any key', async () => {
        global.fetch = jest.fn().mockResolvedValue(reply({ role: 'assistant', content: 'hi' }));
        const bot = setup('builtin');
        await bot.handleSend();
        const [url, options] = global.fetch.mock.calls[0];
        expect(url).toBe('/api/llm');
        expect(options.headers.Authorization).toBeUndefined();
        expect(JSON.parse(options.body).model).toBeUndefined();
    });
});
