// Shared AI layer (2026-10-09): one request shape, four providers.
let savedConfig: any = null;
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    systemParam: {
      findUnique: jest.fn(async ({ where }: any) => (where.key === 'AI_CONFIG' && savedConfig ? { value: JSON.stringify(savedConfig) } : null)),
      upsert: jest.fn(async () => ({})),
    },
  })),
}));
jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn(), get: jest.fn() } }));
import axios from 'axios';
import { aiComplete, parseAiJson, maskAiConfig } from './ai-provider';
import { AI_PROMPTS, fillTemplate } from './ai-prompts';

const post = (axios as any).post as jest.Mock;
const req = { feature: 'test', system: 'SYS', prompt: 'שלום', maxTokens: 50 };

describe('aiComplete — per provider', () => {
  beforeEach(() => post.mockReset());

  it('Claude: /v1/messages, x-api-key, system apart', async () => {
    savedConfig = { activeProvider: 'anthropic', providers: { anthropic: { apiKey: 'sk-ant-1', model: 'claude-x' } } };
    post.mockResolvedValue({ data: { content: [{ type: 'text', text: 'כן' }] } });
    const r = await aiComplete(req);
    const [url, body, opts] = post.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(body).toMatchObject({ model: 'claude-x', system: 'SYS', max_tokens: 50, messages: [{ role: 'user', content: 'שלום' }] });
    expect(opts.headers['x-api-key']).toBe('sk-ant-1');
    expect(r.text).toBe('כן');
  });

  it('Gemini: generateContent, systemInstruction, assistant → model, internal base URL', async () => {
    savedConfig = { activeProvider: 'gemini', providers: { gemini: { apiKey: 'g-key', model: 'gemini-2.5-flash', baseUrl: 'https://ai.corp.local/gemini/' } } };
    post.mockResolvedValue({ data: { candidates: [{ content: { parts: [{ text: 'זמין' }] } }] } });
    const r = await aiComplete({ feature: 't', system: 'SYS', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], json: true });
    const [url, body, opts] = post.mock.calls[0];
    expect(url).toBe('https://ai.corp.local/gemini/v1beta/models/gemini-2.5-flash:generateContent');
    expect(body.systemInstruction.parts[0].text).toBe('SYS');
    expect(body.contents.map((c: any) => c.role)).toEqual(['user', 'model']);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(opts.headers['x-goog-api-key']).toBe('g-key');
    expect(r.text).toBe('זמין');
  });

  it('OpenAI-compatible gateway: Bearer, system message first', async () => {
    savedConfig = { activeProvider: 'openai', providers: { openai: { apiKey: 'k', model: 'gemini-2.5-pro', baseUrl: 'https://gw.corp/v1' } } };
    post.mockResolvedValue({ data: { choices: [{ message: { content: 'ok' } }] } });
    await aiComplete(req);
    const [url, body, opts] = post.mock.calls[0];
    expect(url).toBe('https://gw.corp/v1/chat/completions');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(opts.headers.Authorization).toBe('Bearer k');
  });

  it('Azure OpenAI: deployment URL + api-key header', async () => {
    savedConfig = { activeProvider: 'azure', providers: { azure: { apiKey: 'az', model: 'gpt4o-prod', baseUrl: 'https://res.openai.azure.com' } } };
    post.mockResolvedValue({ data: { choices: [{ message: { content: 'ok' } }] } });
    await aiComplete(req);
    const [url, body, opts] = post.mock.calls[0];
    expect(url).toContain('https://res.openai.azure.com/openai/deployments/gpt4o-prod/chat/completions?api-version=');
    expect(body.model).toBeUndefined();
    expect(opts.headers['api-key']).toBe('az');
  });

  it('a blocked network says so (firewall hint)', async () => {
    savedConfig = { activeProvider: 'anthropic', providers: { anthropic: { apiKey: 'k' } } };
    post.mockRejectedValue(Object.assign(new Error('connect'), { code: 'ETIMEDOUT' }));
    await expect(aiComplete(req)).rejects.toThrow('Firewall');
  });

  it('keys never leave masked', () => {
    const m = maskAiConfig({ activeProvider: 'gemini', providers: { gemini: { apiKey: 'AIzaSyABCDEFGH1234' } } });
    expect((m.providers as any).gemini.apiKey).toBe('AIza…1234');
    expect((m.providers as any).gemini.hasKey).toBe(true);
  });

  it('JSON answers survive ```json fences', () => {
    expect(parseAiJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});

describe('prompt catalog', () => {
  it.each(AI_PROMPTS.map(p => [p.id, p]))('%s: every data field is in the prompt, the sample fills them all', (_id, p: any) => {
    const text = `${p.template}${p.system ?? ''}`;
    for (const v of Object.keys(p.vars)) expect(text).toContain(`{{${v}}}`);
    expect(fillTemplate(text, p.sample)).not.toMatch(/\{\{\w+\}\}/);
  });
});
