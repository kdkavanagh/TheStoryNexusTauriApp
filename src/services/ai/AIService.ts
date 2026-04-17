import { AIModel, AIProvider, AISettings, PromptMessage } from '@/types/story';
import { db } from '../database';
import OpenAI from 'openai';

export class AIService {
    private static instance: AIService;
    private settings: AISettings | null = null;
    private readonly LOCAL_API_URL = 'http://localhost:1234/v1';
    private readonly CLAUDE_API_URL = 'https://api.anthropic.com/v1';
    private readonly CLAUDE_API_VERSION = '2023-06-01';
    private openRouter: OpenAI | null = null;
    private openAI: OpenAI | null = null;
    private abortController: AbortController | null = null;

    private constructor() { }

    static getInstance(): AIService {
        if (!AIService.instance) {
            AIService.instance = new AIService();
        }
        return AIService.instance;
    }

    async initialize() {
        // Load or create settings
        const settings = await db.aiSettings.toArray();
        this.settings = settings[0] || await this.createInitialSettings();
    }

    private async createInitialSettings(): Promise<AISettings> {
        const localModels = await this.fetchLocalModels();
        const settings: AISettings = {
            id: crypto.randomUUID(),
            createdAt: new Date(),
            localApiUrl: 'http://localhost:1234/v1',
            availableModels: localModels,
        };
        await db.aiSettings.add(settings);
        return settings;
    }

    private async fetchLocalModels(): Promise<AIModel[]> {
        try {
            // Always use the URL from settings if available, otherwise fall back to default
            const apiUrl = this.settings?.localApiUrl || this.LOCAL_API_URL;
            console.log(`[AIService] Fetching local models from: ${apiUrl}`);

            const response = await fetch(`${apiUrl}/models`);
            if (!response.ok) {
                console.error(`[AIService] Failed to fetch local models: ${response.status} ${response.statusText}`);
                throw new Error('Failed to fetch local models');
            }

            const result = await response.json();
            console.log(`[AIService] Received ${result.data.length} local models from API`);

            const models = result.data.map((model: { id: string, object: string, owned_by: string }) => ({
                id: `local/${model.id}`,
                name: model.id, // We could prettify this name if needed
                provider: 'local' as AIProvider,
                contextLength: 16384, // Default value since not provided by API
                enabled: true
            }));

            console.log(`[AIService] Mapped ${models.length} local models`);
            return models;
        } catch (error) {
            console.warn('[AIService] Failed to fetch local models:', error);
            // Fallback to default model if fetch fails
            console.log('[AIService] Using fallback local model');
            return [{
                id: 'local',
                name: 'Local Model',
                provider: 'local',
                contextLength: 16384,
                enabled: true
            }];
        }
    }

    private initializeOpenRouter() {
        if (!this.settings?.openrouterKey) return;

        this.openRouter = new OpenAI({
            baseURL: 'https://openrouter.ai/api/v1',
            apiKey: this.settings.openrouterKey,
            dangerouslyAllowBrowser: true,
            defaultHeaders: {
                'HTTP-Referer': 'http://localhost:1420',
                'X-Title': 'Story Forge Desktop',
            }
        });
    }

    private initializeOpenAI() {
        if (!this.settings?.openaiKey) return;

        this.openAI = new OpenAI({
            baseURL: "https://api.poe.com/v1",
            apiKey: this.settings.openaiKey,
            dangerouslyAllowBrowser: true,
	      defaultHeaders: {
    'x-stainless-arch': null,
    'x-stainless-lang': null,
    'x-stainless-os': null,
    'x-stainless-package-version': null,
    'x-stainless-retry-count': null,
    'x-stainless-runtime': null,
    'x-stainless-runtime-version': null,
    'x-stainless-timeout': null,
  }
        });
    }

    async updateKey(provider: AIProvider, key: string) {
        if (!this.settings) throw new Error('AIService not initialized');

        console.log(`[AIService] Updating key for provider: ${provider}`);
        const update: Partial<AISettings> = {
            ...(provider === 'openai' && { openaiKey: key }),
            ...(provider === 'openrouter' && { openrouterKey: key }),
            ...(provider === 'claude' && { claudeKey: key })
        };

        console.log(`[AIService] Updating database with new key for ${provider}`);
        await db.aiSettings.update(this.settings.id, update);
        Object.assign(this.settings, update);
        console.log(`[AIService] Key updated in memory and database`);

        // Initialize clients if needed
        if (provider === 'openrouter') {
            console.log(`[AIService] Initializing OpenRouter client`);
            this.initializeOpenRouter();
        } else if (provider === 'openai') {
            console.log(`[AIService] Initializing OpenAI client`);
            this.initializeOpenAI();
        }

        // Fetch available models when key is updated
        console.log(`[AIService] Fetching available models for ${provider} after key update`);
        await this.fetchAvailableModels(provider);
    }

    private async fetchAvailableModels(provider: AIProvider) {
        if (!this.settings) throw new Error('AIService not initialized');

        console.log(`[AIService] Fetching available models for provider: ${provider}`);
        try {
            let models: AIModel[] = [];

            switch (provider) {
                case 'local':
                    console.log(`[AIService] Fetching local models from: ${this.settings.localApiUrl || this.LOCAL_API_URL}`);
                    models = await this.fetchLocalModels();
                    break;
                case 'openai':
                    if (this.settings.openaiKey) {
                        console.log('[AIService] Fetching OpenAI models');
                        models = await this.fetchOpenAIModels();
                    }
                    break;
                case 'openrouter':
                    if (this.settings.openrouterKey) {
                        console.log('[AIService] Fetching OpenRouter models');
                        models = await this.fetchOpenRouterModels();
                    }
                    break;
                case 'claude':
                    if (this.settings.claudeKey) {
                        console.log('[AIService] Fetching Claude models');
                        models = await this.fetchClaudeModels();
                    }
                    break;
            }

            console.log(`[AIService] Fetched ${models.length} models for ${provider}`);

            // Update only models from this provider, keep others
            const existingModels = this.settings.availableModels.filter(m => m.provider !== provider);
            const updatedModels = [...existingModels, ...models];

            console.log(`[AIService] Updating database with ${updatedModels.length} total models`);
            await db.aiSettings.update(this.settings.id, {
                availableModels: updatedModels,
                lastModelsFetch: new Date()
            });

            this.settings.availableModels = updatedModels;
            this.settings.lastModelsFetch = new Date();
            console.log(`[AIService] Models updated in memory and database`);
        } catch (error) {
            console.error('Error fetching models:', error);
            throw error;
        }
    }

    private async fetchOpenAIModels(): Promise<AIModel[]> {
        // Implementation for OpenAI models fetch
        const response = await fetch('https://api.poe.com/v1/models', {
            headers: {
                'Authorization': `Bearer ${this.settings?.openaiKey}`
            }
        });

        if (!response.ok) throw new Error('Failed to fetch OpenAI models');
        const data = await response.json();

        return data.data
//            .filter((model: any) => model.id.startsWith('gpt'))
            .map((model: any) => ({
                id: model.id,
                name: model.id,
                provider: 'openai' as AIProvider,
                contextLength: model.context_length || 16384,
                enabled: true
            }));
    }

    private async fetchOpenRouterModels(): Promise<AIModel[]> {
        const response = await fetch('https://openrouter.ai/api/v1/models', {
            headers: {
                'Authorization': `Bearer ${this.settings?.openrouterKey}`
            }
        });

        if (!response.ok) throw new Error('Failed to fetch OpenRouter models');
        const data = await response.json();

        return data.data.map((model: any) => ({
            id: model.id,
            name: model.name,
            provider: 'openrouter' as AIProvider,
            contextLength: model.context_length,
            enabled: true
        }));
    }

    private async fetchClaudeModels(): Promise<AIModel[]> {
        const response = await fetch(`${this.CLAUDE_API_URL}/models`, {
            headers: {
                'x-api-key': this.settings?.claudeKey ?? '',
                'anthropic-version': this.CLAUDE_API_VERSION,
                'anthropic-dangerous-direct-browser-access': 'true'
            }
        });

        if (!response.ok) throw new Error('Failed to fetch Claude models');
        const data = await response.json();

        return data.data.map((model: any) => ({
            id: model.id,
            name: model.display_name || model.id,
            provider: 'claude' as AIProvider,
            contextLength: model.max_input_tokens ?? 200000,
            enabled: true
        }));
    }

    async getAvailableModels(provider?: AIProvider, forceRefresh: boolean = true): Promise<AIModel[]> {
        if (!this.settings) throw new Error('AIService not initialized');

        console.log(`[AIService] getAvailableModels called for provider: ${provider || 'all'}, forceRefresh: ${forceRefresh}`);

        // Ensure settings are up to date
        const dbSettings = await db.aiSettings.get(this.settings.id);
        if (dbSettings) {
            console.log(`[AIService] Loaded settings from DB, last fetch: ${dbSettings.lastModelsFetch?.toISOString() || 'never'}`);
            this.settings = dbSettings;
        }

        // Check if we should fetch fresh models
        if (provider && forceRefresh) {
            console.log(`[AIService] Fetching fresh models for provider: ${provider}`);
            await this.fetchAvailableModels(provider);
        }

        const result = provider
            ? this.settings.availableModels.filter(m => m.provider === provider)
            : this.settings.availableModels;

        console.log(`[AIService] Returning ${result.length} models`);
        return result;
    }

    async generateWithLocalModel(
        messages: PromptMessage[],
        temperature: number = 1.0,
        maxTokens: number = 2048,
        top_p?: number,
        top_k?: number,
        repetition_penalty?: number,
        min_p?: number
    ): Promise<Response> {
        // Create request body with optional parameters
        const requestBody: any = {
            messages,
            stream: true,
            model: 'local/llama-3.2-3b-instruct',
            temperature,
            max_tokens: maxTokens,
        };

        // Only add parameters if they are defined and not 0 (disabled)
        if (top_p !== undefined && top_p !== 0) {
            requestBody.top_p = top_p;
        }

        if (top_k !== undefined && top_k !== 0) {
            requestBody.top_k = top_k;
        }

        if (repetition_penalty !== undefined && repetition_penalty !== 0) {
            requestBody.repetition_penalty = repetition_penalty;
        }

        if (min_p !== undefined && min_p !== 0) {
            requestBody.min_p = min_p;
        }

        this.abortController = new AbortController();

        return fetch(`${this.settings.localApiUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: this.abortController.signal,
        });
    }

    async processStreamedResponse(response: Response,
        onToken: (text: string) => void,
        onComplete: () => void,
        onError: (error: Error) => void
    ) {
        if (!response.body) {
            return onError(new Error('Response body is null'));
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    onComplete();
                    break;
                }

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.trim() !== '');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.substring(6);
                        if (data === '[DONE]') {
                            onComplete();
                            return;
                        }
                        try {
                            const json = JSON.parse(data);
                            const text = json.choices[0]?.delta?.content || '';
                            if (text) {
                                onToken(text);
                            }
                        } catch (e) {
                            // Ignore parsing errors for non-JSON lines
                        }
                    }
                }
            }
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                console.log('Stream reading aborted.');
                onComplete(); // Treat abort as completion of the stream from the client's perspective
            } else {
                onError(error as Error);
            }
        } finally {
            this.abortController = null;
        }
    }

    async generateWithOpenAI(
        messages: PromptMessage[],
        modelId: string,
        temperature: number = 1.0,
        maxTokens: number = 2048,
        top_p?: number,
        top_k?: number,
        repetition_penalty?: number,
        min_p?: number
    ): Promise<Response> {
        if (!this.settings?.openaiKey) {
            throw new Error('OpenAI API key not set');
        }
        if (!this.openAI) {
            this.initializeOpenAI();
        }
        if (!this.openAI) {
            throw new Error('OpenAI client not initialized');
        }

        const body: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
            model: modelId,
            messages: messages,
            temperature: temperature,
            max_tokens: maxTokens,
            stream: true,
        };

        // Add optional parameters if they are defined and not 0
        if (top_p !== undefined && top_p !== 0) { body.top_p = top_p; }
        // top_k is not directly supported in the same way by OpenAI's API
        if (repetition_penalty !== undefined && repetition_penalty !== 0) { body.frequency_penalty = repetition_penalty; }
        // min_p is not a standard OpenAI parameter

        this.abortController = new AbortController();

        try {
            const stream = await this.openAI.chat.completions.create(body, { signal: this.abortController.signal });

            const responseStream = new ReadableStream({
                async start(controller) {
                    try {
                        for await (const chunk of stream) {
                            const content = chunk.choices[0]?.delta?.content || '';
                            if (content) {
                                const formattedChunk = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
                                controller.enqueue(new TextEncoder().encode(formattedChunk));
                            }
                        }
                        controller.close();
                    } catch (error) {
                        if ((error as Error).name === 'AbortError') {
                            console.log('OpenAI stream aborted');
                            controller.close();
                        } else {
                            controller.error(error);
                        }
                    }
                }
            });

            return new Response(responseStream, {
                headers: { 'Content-Type': 'text/event-stream' }
            });

        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                console.log('OpenAI generation aborted');
                return new Response(null, { status: 204 }); // Return an empty response
            }
            console.error('Error generating with OpenAI:', error);
            throw error;
        }
    }

    async generateWithOpenRouter(
        messages: PromptMessage[],
        modelId: string,
        temperature: number = 1.0,
        maxTokens: number = 2048,
        top_p?: number,
        top_k?: number,
        repetition_penalty?: number,
        min_p?: number
    ): Promise<Response> {
        if (!this.settings?.openrouterKey) {
            throw new Error('OpenRouter API key not set');
        }
        if (!this.openRouter) {
            this.initializeOpenRouter();
        }
        if (!this.openRouter) {
            throw new Error('OpenRouter client not initialized');
        }

        const body: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
            model: modelId,
            messages: messages,
            temperature: temperature,
            max_tokens: maxTokens,
            stream: true,
        };

        // Add optional parameters if they are defined and not 0
        if (top_p !== undefined && top_p !== 0) { body.top_p = top_p; }
        if (repetition_penalty !== undefined && repetition_penalty !== 0) { body.frequency_penalty = repetition_penalty; }
        // min_p and top_k are often included in transforms/routing, but we can pass them
        if (top_k !== undefined && top_k !== 0) {
            // This is a common way to pass extra params to OpenRouter
            Object.assign(body, { top_k });
        }
        if (min_p !== undefined && min_p !== 0) {
            Object.assign(body, { min_p });
        }

        this.abortController = new AbortController();

        try {
            const stream = await this.openRouter.chat.completions.create(body, { signal: this.abortController.signal });

            const responseStream = new ReadableStream({
                async start(controller) {
                    try {
                        for await (const chunk of stream) {
                            const content = chunk.choices[0]?.delta?.content || '';
                            if (content) {
                                const formattedChunk = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
                                controller.enqueue(new TextEncoder().encode(formattedChunk));
                            }
                        }
                        controller.close();
                    } catch (error) {
                        if ((error as Error).name === 'AbortError') {
                            console.log('OpenRouter stream aborted');
                            controller.close();
                        } else {
                            controller.error(error);
                        }
                    }
                }
            });

            return new Response(responseStream, {
                headers: { 'Content-Type': 'text/event-stream' }
            });

        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                console.log('OpenRouter generation aborted');
                return new Response(null, { status: 204 }); // Return an empty response
            }
            console.error('Error generating with OpenRouter:', error);
            throw error;
        }
    }

    async generateWithClaude(
        messages: PromptMessage[],
        modelId: string,
        temperature: number = 1.0,
        maxTokens: number = 2048,
        top_p?: number,
        top_k?: number,
        repetition_penalty?: number,
        min_p?: number
    ): Promise<Response> {
        if (!this.settings?.claudeKey) {
            throw new Error('Claude API key not set');
        }

        // Claude requires system messages as a top-level field, not in messages[]
        const systemParts: string[] = [];
        const userMessages: PromptMessage[] = [];
        for (const m of messages) {
            if (m.role === 'system') {
                systemParts.push(m.content);
            } else {
                userMessages.push(m);
            }
        }

        // Enable prompt caching on the two highest-value breakpoints:
        //   1. The system prompt — stable across turns, often the largest block.
        //   2. The final message — sets up a cache prefix covering the full
        //      conversation so the next turn can read it back.
        // Claude silently ignores cache_control on content below the minimum
        // cacheable size, so it's safe to set unconditionally.
        const preparedMessages = userMessages.map((m, i) => {
            if (i !== userMessages.length - 1) return m;
            return {
                role: m.role,
                content: [{
                    type: 'text',
                    text: m.content,
                    cache_control: { type: 'ephemeral' },
                }],
            };
        });

        const body: Record<string, unknown> = {
            model: modelId,
            messages: preparedMessages,
            max_tokens: maxTokens,
            temperature,
            stream: true,
        };
        if (systemParts.length > 0) {
            body.system = [{
                type: 'text',
                text: systemParts.join('\n\n'),
                cache_control: { type: 'ephemeral' },
            }];
        }
        if (top_p !== undefined && top_p !== 0) body.top_p = top_p;
        if (top_k !== undefined && top_k !== 0) body.top_k = top_k;
        // Claude doesn't support repetition_penalty or min_p; silently ignore.

        this.abortController = new AbortController();

        let upstream: Response;
        try {
            upstream = await fetch(`${this.CLAUDE_API_URL}/messages`, {
                method: 'POST',
                headers: {
                    'x-api-key': this.settings.claudeKey,
                    'anthropic-version': this.CLAUDE_API_VERSION,
                    'anthropic-dangerous-direct-browser-access': 'true',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                signal: this.abortController.signal,
            });
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                return new Response(null, { status: 204 });
            }
            throw error;
        }

        if (!upstream.ok || !upstream.body) {
            const errText = await upstream.text().catch(() => '');
            throw new Error(`Claude API error ${upstream.status}: ${errText}`);
        }

        // Translate Claude SSE events into the OpenAI-style chunks expected by processStreamedResponse.
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();

        const responseStream = new ReadableStream({
            async start(controller) {
                let buffer = '';
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });

                        // SSE events are separated by blank lines.
                        let sepIdx: number;
                        while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
                            const rawEvent = buffer.slice(0, sepIdx);
                            buffer = buffer.slice(sepIdx + 2);

                            // Collect data: lines (ignore event: line — the JSON carries `type`).
                            const dataLines: string[] = [];
                            for (const line of rawEvent.split('\n')) {
                                if (line.startsWith('data:')) {
                                    dataLines.push(line.slice(5).trim());
                                }
                            }
                            if (dataLines.length === 0) continue;

                            const payload = dataLines.join('\n');
                            try {
                                const json = JSON.parse(payload);
                                if (
                                    json.type === 'content_block_delta' &&
                                    json.delta?.type === 'text_delta' &&
                                    typeof json.delta.text === 'string' &&
                                    json.delta.text.length > 0
                                ) {
                                    const formatted = `data: ${JSON.stringify({
                                        choices: [{ delta: { content: json.delta.text } }]
                                    })}\n\n`;
                                    controller.enqueue(encoder.encode(formatted));
                                }
                                // message_stop, message_delta, ping etc. are no-ops for content streaming.
                            } catch {
                                // Ignore non-JSON data lines.
                            }
                        }
                    }
                    controller.close();
                } catch (error) {
                    if ((error as Error).name === 'AbortError') {
                        console.log('Claude stream aborted');
                        controller.close();
                    } else {
                        controller.error(error);
                    }
                }
            }
        });

        return new Response(responseStream, {
            headers: { 'Content-Type': 'text/event-stream' }
        });
    }

    // Add getter methods for settings
    getOpenAIKey(): string | undefined {
        return this.settings?.openaiKey;
    }

    getOpenRouterKey(): string | undefined {
        return this.settings?.openrouterKey;
    }

    getClaudeKey(): string | undefined {
        return this.settings?.claudeKey;
    }

    getLocalApiUrl(): string {
        return this.settings?.localApiUrl || this.LOCAL_API_URL;
    }

    async updateLocalApiUrl(url: string): Promise<void> {
        if (!this.settings) {
            throw new Error('Settings not initialized');
        }
        await db.aiSettings.update(this.settings.id, { localApiUrl: url });
        this.settings.localApiUrl = url;

        // Re-fetch local models as the URL has changed
        await this.fetchAvailableModels('local');
    }

    getSettings(): AISettings | null {
        return this.settings;
    }

    abortStream(): void {
        if (this.abortController) {
            console.log('[AIService] Aborting stream');
            this.abortController.abort();
            this.abortController = null;
        }
    }
}

export const aiService = AIService.getInstance();
