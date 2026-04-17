import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

interface Options {
    /** Absolute path of the JSON file used to persist global state. */
    filePath: string;
    /** URL the middleware listens on. Default: /api/global-state */
    route?: string;
    /** Max POST body size in bytes. Default: 50 MB. */
    maxBodyBytes?: number;
}

export function stateServer(opts: Options): Plugin {
    const route = opts.route ?? '/api/global-state';
    const maxBodyBytes = opts.maxBodyBytes ?? 50 * 1024 * 1024;

    const sendJson = (res: ServerResponse, status: number, payload: unknown) => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(payload));
    };

    const handleGet = async (res: ServerResponse) => {
        if (!existsSync(opts.filePath)) {
            sendJson(res, 404, { error: 'no saved state' });
            return;
        }
        const body = await readFile(opts.filePath, 'utf8');
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(body);
    };

    const handlePost = async (req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of req) {
            total += (chunk as Buffer).length;
            if (total > maxBodyBytes) {
                sendJson(res, 413, { error: `body exceeds ${maxBodyBytes} bytes` });
                return;
            }
            chunks.push(chunk as Buffer);
        }
        const body = Buffer.concat(chunks).toString('utf8');
        try {
            JSON.parse(body);
        } catch {
            sendJson(res, 400, { error: 'body is not valid JSON' });
            return;
        }
        await mkdir(path.dirname(opts.filePath), { recursive: true });
        await writeFile(opts.filePath, body, 'utf8');
        sendJson(res, 200, { ok: true, bytes: body.length, path: opts.filePath });
    };

    return {
        name: 'storynexus-state-server',
        configureServer(server) {
            server.middlewares.use(route, (req, res, next) => {
                if (req.method === 'GET') {
                    handleGet(res).catch(next);
                } else if (req.method === 'POST') {
                    handlePost(req, res).catch(next);
                } else {
                    next();
                }
            });
        },
    };
}
