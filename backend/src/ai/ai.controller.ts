import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Module, Param, Post, Put, Request, UseGuards } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { AI_PROVIDERS, AiConfig, AiProviderId, aiComplete, maskAiConfig, readAiConfig, recentAiCalls, saveAiConfig } from './ai-provider';
import { AI_PROMPTS, fillTemplate, readPromptOverrides, savePromptOverride } from './ai-prompts';
import { checkRule, firewallRequestText, firewallRules, serverIdentity } from './ai-network';

// AdminPanel → אינטגרציות → AI (2026-10-09): provider + keys, every prompt
// (view / edit / try on sample data), firewall rules + a live check, and the
// recent AI calls. ADMIN only.
@Controller('ai')
@UseGuards(JwtGuard)
export class AiController {
  private admin(req: any) {
    if (req.user?.role !== 'ADMIN') throw new ForbiddenException('רק מנהל מערכת יכול לנהל את הגדרות ה-AI');
  }

  @Get('config')
  async getConfig(@Request() req: any) {
    this.admin(req);
    return { config: maskAiConfig(await readAiConfig()), providers: AI_PROVIDERS };
  }

  // a key that comes back masked ("sk-a…1234") or empty means "keep the saved one";
  // clearKey: true removes it
  @Put('config')
  async putConfig(@Request() req: any, @Body() bodyRaw: any) {
    const body = bodyRaw as AiConfig & { clearKeys?: AiProviderId[] };
    this.admin(req);
    const current = await readAiConfig();
    if (body?.activeProvider && !(body.activeProvider in AI_PROVIDERS)) throw new BadRequestException('ספק לא מוכר');
    const next: AiConfig = {
      activeProvider: body?.activeProvider ?? current.activeProvider,
      proxyUrl: typeof body?.proxyUrl === 'string' ? body.proxyUrl.trim() : current.proxyUrl,
      timeoutMs: typeof body?.timeoutMs === 'number' ? body.timeoutMs : current.timeoutMs,
      providers: { ...current.providers },
    };
    for (const id of Object.keys(AI_PROVIDERS) as AiProviderId[]) {
      const inc = body?.providers?.[id];
      if (!inc) continue;
      const prev = current.providers[id] ?? {};
      const key = typeof inc.apiKey === 'string' && inc.apiKey.trim() && !inc.apiKey.includes('…') ? inc.apiKey.trim() : prev.apiKey;
      next.providers[id] = {
        apiKey: body.clearKeys?.includes(id) ? undefined : key,
        model: inc.model?.trim() || undefined,
        baseUrl: inc.baseUrl?.trim() || undefined,
        apiVersion: inc.apiVersion?.trim() || undefined,
        authHeader: inc.authHeader?.trim() || undefined,
      };
    }
    await saveAiConfig(next);
    return { config: maskAiConfig(next) };
  }

  // one short request to a provider with its SAVED settings
  @Post('test/:provider')
  async test(@Request() req: any, @Param('provider') providerParam: string) {
    const provider = providerParam as AiProviderId;
    this.admin(req);
    if (!(provider in AI_PROVIDERS)) throw new BadRequestException('ספק לא מוכר');
    const cfg = await readAiConfig();
    const r = await aiComplete({ feature: 'בדיקת חיבור', prompt: 'ענה במילה אחת בעברית: האם אתה זמין?', maxTokens: 20 },
      { provider, settings: cfg.providers[provider] ?? {} });
    return { ok: true, answer: r.text.trim(), model: r.model, ms: r.ms };
  }

  @Get('prompts')
  async prompts(@Request() req: any) {
    this.admin(req);
    const overrides = await readPromptOverrides();
    return AI_PROMPTS.map(p => {
      const o = overrides[p.id];
      const template = o?.template ?? p.template;
      const system = o?.system ?? p.system;
      return {
        ...p,
        defaultTemplate: p.template, defaultSystem: p.system ?? null,
        template, system: system ?? null,
        edited: !!o, editedAt: o?.updatedAt ?? null, editedBy: o?.updatedBy ?? null,
        // exactly what would be sent, filled with the sample data
        sampleRendered: { system: system ? fillTemplate(system, p.sample) : null, prompt: fillTemplate(template, p.sample) },
      };
    });
  }

  @Put('prompts/:id')
  async savePrompt(@Request() req: any, @Param('id') id: string, @Body() body: { template?: string; system?: string }) {
    this.admin(req);
    const def = AI_PROMPTS.find(p => p.id === id);
    if (!def) throw new BadRequestException('פרומפט לא מוכר');
    if (!body?.template?.trim()) throw new BadRequestException('הפרומפט ריק');
    // the data placeholders must stay — without them the AI gets no data
    const missing = Object.keys(def.vars).filter(v => !`${body.template}${body.system ?? ''}`.includes(`{{${v}}}`));
    if (missing.length) throw new BadRequestException(`חסרים שדות נתונים בפרומפט: ${missing.map(m => `{{${m}}}`).join(', ')}`);
    await savePromptOverride(id, { template: body.template, ...(def.system !== undefined ? { system: body.system ?? def.system } : {}) }, req.user?.email ?? '');
    return { ok: true };
  }

  @Delete('prompts/:id')
  async resetPrompt(@Request() req: any, @Param('id') id: string) {
    this.admin(req);
    await savePromptOverride(id, null, req.user?.email ?? '');
    return { ok: true };
  }

  // send the prompt (as currently edited, or as given) with the SAMPLE data to the active provider
  @Post('prompts/:id/try')
  async tryPrompt(@Request() req: any, @Param('id') id: string, @Body() body: { template?: string; system?: string }) {
    this.admin(req);
    const def = AI_PROMPTS.find(p => p.id === id);
    if (!def) throw new BadRequestException('פרומפט לא מוכר');
    const o = (await readPromptOverrides())[id];
    const template = body?.template ?? o?.template ?? def.template;
    const system = body?.system ?? o?.system ?? def.system;
    const r = await aiComplete({
      feature: `ניסיון: ${def.title}`, system: system ? fillTemplate(system, def.sample) : undefined,
      prompt: fillTemplate(template, def.sample), maxTokens: 2000, json: def.output === 'json',
    });
    return { text: r.text, provider: r.provider, model: r.model, ms: r.ms };
  }

  @Get('network')
  async network(@Request() req: any) {
    this.admin(req);
    const cfg = await readAiConfig();
    const rules = firewallRules(cfg);
    return { server: serverIdentity(), rules, requestText: firewallRequestText(rules), proxyUrl: cfg.proxyUrl ?? '' };
  }

  @Post('network/check')
  async networkCheck(@Request() req: any) {
    this.admin(req);
    const cfg = await readAiConfig();
    const rules = firewallRules(cfg);
    return Promise.all(rules.map(r => checkRule(r, cfg).then(res => ({ provider: r.provider, label: r.label, ...res }))));
  }

  @Get('calls')
  calls(@Request() req: any) {
    this.admin(req);
    return recentAiCalls();
  }
}

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET || 'fallback-secret', signOptions: { expiresIn: '8h' } })],
  controllers: [AiController],
})
export class AiModule {}
