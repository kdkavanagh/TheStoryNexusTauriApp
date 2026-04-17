import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

interface Options {
    /** Dev-server mount point. Default: /api/claude */
    mount?: string;
    /** Upstream origin. Default: https://api.anthropic.com */
    target?: string;
}

// Browser-populated request headers that must NOT be forwarded upstream:
//  - origin/referer trip the org-level "no direct browser access" rule
//  - host/connection/content-length are recomputed by fetch()
//  - accept-encoding causes upstream to gzip a body we'd then have to decode
const DROP_REQUEST_HEADERS = new Set([
    'host', 'connection', 'origin', 'referer',
    'content-length', 'accept-encoding',
]);

// Upstream response headers that Node manages itself.
const DROP_RESPONSE_HEADERS = new Set([
    'content-encoding', 'transfer-encoding', 'connection',
]);

/**
 * Dev-only proxy that lets the browser call Anthropic via same-origin requests,
 * bypassing CORS. The browser hits /api/claude/v1/... and the dev server
 * forwards to https://api.anthropic.com/v1/..., streaming the response back.
 */
export function claudeProxy(opts: Options = {}): Plugin {
    const mount = opts.mount ?? '/api/claude';
    const target = opts.target ?? 'https://api.anthropic.com';

    const handle = async (req: IncomingMessage, res: ServerResponse) => {
        // Buffer any request body. Anthropic request bodies are small JSON;
        // streaming only matters on the response side.
        let body: Buffer | undefined;
        if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            body = Buffer.concat(chunks);
        }

        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
            if (v == null) continue;
            if (DROP_REQUEST_HEADERS.has(k.toLowerCase())) continue;
            headers[k] = Array.isArray(v) ? v.join(',') : v;
        }

        const upstream = await fetch(`${target}${req.url ?? ''}`, {
            method: req.method,
            headers,
            body,
        });

        res.statusCode = upstream.status;
        upstream.headers.forEach((value, key) => {
            if (DROP_RESPONSE_HEADERS.has(key.toLowerCase())) return;
            res.setHeader(key, value);
        });

        // On non-2xx, buffer the response so we can log headers + body. Error
        // responses are small JSON; streaming isn't needed. 2xx still streams.
        if (!upstream.ok) {
            const rateHeaders: Record<string, string> = {};
            upstream.headers.forEach((v, k) => {
                const lk = k.toLowerCase();
                if (
                    lk.startsWith('anthropic-ratelimit-') ||
                    lk === 'retry-after' ||
                    lk === 'request-id' ||
                    lk === 'anthropic-organization-id'
                ) {
                    rateHeaders[k] = v;
                }
            });
            const text = upstream.body ? await upstream.text() : '';
            console.error(
                `[claude-proxy] ${req.method} ${req.url} → ${upstream.status}`,
                { headers: rateHeaders, body: text.slice(0, 2000) },
            );
            res.end(text);
            return;
        }

        if (!upstream.body) {
            res.end();
            return;
        }

        const reader = upstream.body.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!res.write(Buffer.from(value))) {
                    await new Promise<void>((resolve) => res.once('drain', resolve));
                }
            }
        } finally {
            res.end();
        }
    };

    return {
        name: 'storynexus-claude-proxy',
        configureServer(server) {
            server.middlewares.use(mount, (req, res, next) => {
                handle(req, res).catch((err) => {
                    console.error('[claude-proxy]', err);
                    next(err);
                });
            });
        },
    };
}
