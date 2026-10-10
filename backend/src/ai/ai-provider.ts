import { BadRequestException } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';
import { prisma } from '../prisma-client';

// ── One AI layer for every AI feature (2026-10-09) ──────────────────────────
// Until now every feature called Claude directly (hardcoded model, its own
// copy of the key lookup). Now: the admin picks the provider (AdminPanel →
// אינטגרציות → AI) and every feature goes through aiComplete().
//
// Providers:
//   anthropic — Claude (api.anthropic.com, or a gateway via baseUrl)
//   gemini    — Google Gemini REST (generativelanguage.googleapis.com, or the
//               organisation's internal Gemini endpoint via baseUrl)
//   openai    — any OpenAI-compatible chat-completions API: OpenAI, internal
//               gateways (LiteLLM etc.), Ollama / vLLM, Gemini's OpenAI mode
//   azure     — Azure OpenAI (deployment name = model)
// Settings live in SystemParam AI_CONFIG (JSON). Keys are never sent back to
// the browser in full. The old ANTHROPIC_API_KEY param still works.


export type AiProviderId = 'anthropic' | 'gemini' | 'openai' | 'azure';

export interface AiProviderSettings {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** Azure: api-version; Gemini/OpenAI gateway: optional custom auth header name */
  apiVersion?: string;
  authHeader?: string;
}

export interface AiConfig {
  activeProvider: AiProviderId;
  providers: Partial<Record<AiProviderId, AiProviderSettings>>;
  /** optional outbound HTTP(S) proxy, e.g. http://proxy.corp:8080 */
  proxyUrl?: string;
  timeoutMs?: number;
}

export const AI_PROVIDERS: Record<AiProviderId, { label: string; defaultBaseUrl: string; defaultModel: string; keyHelp: string }> = {
  anthropic: { label: 'Claude (Anthropic)', defaultBaseUrl: 'https://api.anthropic.com', defaultModel: 'claude-haiku-4-5-20251001', keyHelp: 'מפתח API של Anthropic (sk-ant-…)' },
  gemini: { label: 'Gemini (Google)', defaultBaseUrl: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-2.5-flash', keyHelp: 'מפתח API של Gemini, או מפתח ה-Gateway הפנימי' },
  openai: { label: 'OpenAI / תואם OpenAI (Gateway פנימי, Ollama, vLLM)', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4.1-mini', keyHelp: 'מפתח API (Bearer). ל-Ollama מקומי אפשר להשאיר ריק' },
  azure: { label: 'Azure OpenAI', defaultBaseUrl: 'https://<resource>.openai.azure.com', defaultModel: '<deployment-name>', keyHelp: 'מפתח api-key של משאב ה-Azure OpenAI' },
};

const CONFIG_KEY = 'AI_CONFIG';

export async function readAiConfig(): Promise<AiConfig> {
  const [row, legacy] = await Promise.all([
    prisma.systemParam.findUnique({ where: { key: CONFIG_KEY } }),
    prisma.systemParam.findUnique({ where: { key: 'ANTHROPIC_API_KEY' } }),
  ]);
  let cfg: AiConfig = { activeProvider: 'anthropic', providers: {} };
  try { if (row?.value) cfg = { ...cfg, ...JSON.parse(row.value) }; } catch { /* keep defaults */ }
  // back-compat: the old single Claude key
  const legacyKey = legacy?.value?.trim() || process.env.ANTHROPIC_API_KEY || '';
  if (legacyKey && !cfg.providers.anthropic?.apiKey) cfg.providers.anthropic = { ...(cfg.providers.anthropic ?? {}), apiKey: legacyKey };
  return cfg;
}

export async function saveAiConfig(cfg: AiConfig): Promise<void> {
  await prisma.systemParam.upsert({
    where: { key: CONFIG_KEY },
    update: { value: JSON.stringify(cfg) },
    create: { key: CONFIG_KEY, label: 'הגדרות AI (ספק, מודל, מפתחות)', value: JSON.stringify(cfg), type: 'text' },
  });
}

/** for the browser: keys masked */
export function maskAiConfig(cfg: AiConfig): AiConfig & { providers: Record<string, AiProviderSettings & { hasKey: boolean }> } {
  const providers: Record<string, any> = {};
  for (const id of Object.keys(AI_PROVIDERS) as AiProviderId[]) {
    const p = cfg.providers[id] ?? {};
    const k = p.apiKey ?? '';
    providers[id] = { ...p, apiKey: k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '', hasKey: !!k };
  }
  return { ...cfg, providers };
}

export function providerEndpoint(id: AiProviderId, s: AiProviderSettings): string {
  return (s.baseUrl?.trim() || AI_PROVIDERS[id].defaultBaseUrl).replace(/\/+$/, '');
}

// ── recent calls (for the admin screen: who/what/how long/ok) ─────────────
export interface AiCallLog { at: string; feature: string; provider: AiProviderId; model: string; ms: number; ok: boolean; inputChars: number; outputChars: number; error?: string }
const recent: AiCallLog[] = [];
export function recentAiCalls(): AiCallLog[] { return recent.slice().reverse(); }

export interface AiMessage { role: 'user' | 'assistant'; content: string }
export interface AiRequest {
  /** which feature is asking — shown in the call log */
  feature: string;
  system?: string;
  /** a single user prompt, or a whole conversation */
  prompt?: string;
  messages?: AiMessage[];
  maxTokens?: number;
  /** ask for JSON output (providers that support a JSON mode use it) */
  json?: boolean;
}
export interface AiResult { text: string; provider: AiProviderId; model: string; ms: number }

function proxyOf(cfg: AiConfig): AxiosRequestConfig['proxy'] {
  if (!cfg.proxyUrl?.trim()) return undefined;
  try {
    const u = new URL(cfg.proxyUrl.trim());
    return { protocol: u.protocol.replace(':', ''), host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)),
      ...(u.username ? { auth: { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) } } : {}) };
  } catch { return undefined; }
}

function errorText(err: any): string {
  const d = err?.response?.data;
  const msg = d?.error?.message ?? d?.message ?? (typeof d === 'string' ? d.slice(0, 300) : '') ?? '';
  const status = err?.response?.status;
  if (err?.code === 'ECONNABORTED') return 'פג הזמן לתשובת ה-AI';
  if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET'].includes(err?.code)) {
    return `אין חיבור לשרת ה-AI (${err.code}) — ייתכן שחסר חוק Firewall; ראה ניהול → אינטגרציות → AI → Firewall`;
  }
  return `${status ? `status ${status}: ` : ''}${msg || err?.message || 'שגיאה לא ידועה'}`;
}

/** Send one request to the active provider and return its text. */
export async function aiComplete(req: AiRequest, override?: { provider: AiProviderId; settings: AiProviderSettings }): Promise<AiResult> {
  const cfg = await readAiConfig();
  const provider = override?.provider ?? cfg.activeProvider;
  const s = override?.settings ?? cfg.providers[provider] ?? {};
  const model = s.model?.trim() || AI_PROVIDERS[provider].defaultModel;
  const messages: AiMessage[] = req.messages?.length ? req.messages : [{ role: 'user', content: req.prompt ?? '' }];
  const maxTokens = req.maxTokens ?? 1500;
  const base = providerEndpoint(provider, s);
  const timeout = cfg.timeoutMs ?? 120_000;
  const proxy = proxyOf(cfg);
  if (!s.apiKey && provider !== 'openai') throw new BadRequestException(`לא הוגדר מפתח API לספק ${AI_PROVIDERS[provider].label} — ניהול → אינטגרציות → AI`);

  const started = Date.now();
  const inputChars = (req.system ?? '').length + messages.reduce((n, m) => n + m.content.length, 0);
  let text = '';
  try {
    if (provider === 'anthropic') {
      const res = await axios.post(`${base}/v1/messages`, {
        model, max_tokens: maxTokens, ...(req.system ? { system: req.system } : {}), messages,
      }, { headers: { 'x-api-key': s.apiKey!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout, proxy });
      text = (res.data?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    } else if (provider === 'gemini') {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      headers[s.authHeader?.trim() || 'x-goog-api-key'] = s.authHeader?.trim()?.toLowerCase() === 'authorization' ? `Bearer ${s.apiKey}` : s.apiKey!;
      const res = await axios.post(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
        contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: maxTokens, ...(req.json ? { responseMimeType: 'application/json' } : {}) },
      }, { headers, timeout, proxy });
      text = (res.data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
      if (!text && res.data?.promptFeedback?.blockReason) throw new Error(`Gemini חסם את הבקשה: ${res.data.promptFeedback.blockReason}`);
    } else {
      const isAzure = provider === 'azure';
      const url = isAzure
        ? `${base}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${encodeURIComponent(s.apiVersion?.trim() || '2024-10-21')}`
        : `${base}/chat/completions`;
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (isAzure) headers['api-key'] = s.apiKey!;
      else if (s.apiKey) headers[s.authHeader?.trim() || 'Authorization'] = (s.authHeader?.trim() && s.authHeader.trim().toLowerCase() !== 'authorization') ? s.apiKey : `Bearer ${s.apiKey}`;
      const res = await axios.post(url, {
        ...(isAzure ? {} : { model }),
        max_tokens: maxTokens,
        messages: [...(req.system ? [{ role: 'system', content: req.system }] : []), ...messages],
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      }, { headers, timeout, proxy });
      text = res.data?.choices?.[0]?.message?.content ?? '';
    }
  } catch (err: any) {
    const error = err instanceof BadRequestException ? err.message : errorText(err);
    recent.push({ at: new Date().toISOString(), feature: req.feature, provider, model, ms: Date.now() - started, ok: false, inputChars, outputChars: 0, error });
    if (recent.length > 100) recent.shift();
    throw new BadRequestException(`שגיאת AI (${AI_PROVIDERS[provider].label}): ${error}`);
  }
  const ms = Date.now() - started;
  recent.push({ at: new Date().toISOString(), feature: req.feature, provider, model, ms, ok: true, inputChars, outputChars: text.length });
  if (recent.length > 100) recent.shift();
  return { text, provider, model, ms };
}

/** JSON answer: tolerant of ```json fences and text around the object */
export function parseAiJson<T = any>(raw: string): T {
  const fenced = raw.replace(/```(?:json)?/gi, '');
  const m = fenced.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : fenced);
}
