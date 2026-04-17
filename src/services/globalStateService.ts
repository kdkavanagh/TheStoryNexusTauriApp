import { db } from './database';
import { aiService } from './ai/AIService';
import { buildStoryExport, StoryExport } from './storyExportService';
import type { AISettings, Note, Prompt, Template } from '@/types/story';

export const GLOBAL_STATE_ENDPOINT = '/api/global-state';

export interface GlobalStateFile {
    version: '1.0';
    type: 'global-state';
    exportDate: string;
    aiSettings: AISettings | null;
    stories: StoryExport[];
    notes: Note[];
    userPrompts: Prompt[];
    userTemplates: Template[];
}

// Dexie stores Date objects; JSON round-trips those as ISO strings. This
// reviver rehydrates strict ISO-8601 UTC timestamps back to Date on load so
// code downstream (e.g. `foo.createdAt.toISOString()`) keeps working.
// The pattern requires the T and Z delimiters, so it won't match free-form
// user content.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const dateReviver = (_key: string, value: unknown): unknown => {
    if (typeof value === 'string' && ISO_DATE_RE.test(value)) return new Date(value);
    return value;
};

async function buildSnapshot(): Promise<GlobalStateFile> {
    const [aiSettingsRows, stories, notes, allPrompts, allTemplates] = await Promise.all([
        db.aiSettings.toArray(),
        db.stories.toArray(),
        db.notes.toArray(),
        db.prompts.toArray(),
        db.templates.toArray(),
    ]);

    const storyExports = await Promise.all(stories.map((s) => buildStoryExport(s.id)));

    return {
        version: '1.0',
        type: 'global-state',
        exportDate: new Date().toISOString(),
        aiSettings: aiSettingsRows[0] ?? null,
        stories: storyExports,
        notes,
        userPrompts: allPrompts.filter((p) => !p.isSystem),
        userTemplates: allTemplates.filter((t) => !t.isSystem),
    };
}

function validate(data: unknown): asserts data is GlobalStateFile {
    if (!data || typeof data !== 'object') throw new Error('invalid state: not an object');
    const obj = data as Partial<GlobalStateFile>;
    if (obj.type !== 'global-state') throw new Error(`invalid state: type=${obj.type}`);
    if (!Array.isArray(obj.stories)) throw new Error('invalid state: stories missing');
}

export const globalStateService = {
    /**
     * Snapshot every user-scoped table plus AI settings and POST to the
     * dev-server endpoint backed by a JSON file on disk.
     */
    async saveToServer(): Promise<{ bytes: number }> {
        const snapshot = await buildSnapshot();
        const body = JSON.stringify(snapshot);
        const res = await fetch(GLOBAL_STATE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`save failed ${res.status}: ${text}`);
        }
        return { bytes: body.length };
    },

    /**
     * Fetch the saved snapshot and replace every user-scoped row in Dexie.
     * System prompts/templates (isSystem) are preserved — they're seeded on
     * DB population and shouldn't be overwritten.
     */
    async loadFromServer(): Promise<{ stories: number }> {
        const res = await fetch(GLOBAL_STATE_ENDPOINT);
        if (res.status === 404) throw new Error('no saved state on server');
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`load failed ${res.status}: ${text}`);
        }
        const raw = await res.text();
        const data = JSON.parse(raw, dateReviver);
        validate(data);

        // Cancel any in-flight generation before we start mutating tables.
        aiService.abortStream();

        await db.transaction(
            'rw',
            [
                db.stories, db.chapters, db.lorebookEntries, db.sceneBeats, db.aiChats,
                db.notes, db.prompts, db.templates, db.aiSettings,
            ],
            async () => {
                // Wipe user-scoped content. Keep system prompts/templates since
                // those are re-seeded on DB populate, not user-authored.
                await Promise.all([
                    db.stories.clear(),
                    db.chapters.clear(),
                    db.lorebookEntries.clear(),
                    db.sceneBeats.clear(),
                    db.aiChats.clear(),
                    db.notes.clear(),
                    db.prompts.where('isSystem').notEqual(1).delete().catch(async () => {
                        // `isSystem` is boolean, not indexed as 0/1; fall back to scan.
                        const userPrompts = await db.prompts.filter((p) => !p.isSystem).toArray();
                        await db.prompts.bulkDelete(userPrompts.map((p) => p.id));
                    }),
                    db.templates.filter((t) => !t.isSystem).toArray().then((rows) =>
                        db.templates.bulkDelete(rows.map((r) => r.id))
                    ),
                    db.aiSettings.clear(),
                ]);

                // Repopulate preserving original IDs.
                for (const ex of data.stories) {
                    await db.stories.add(ex.story);
                    if (ex.chapters.length) await db.chapters.bulkAdd(ex.chapters);
                    if (ex.lorebookEntries.length) await db.lorebookEntries.bulkAdd(ex.lorebookEntries);
                    if (ex.sceneBeats.length) await db.sceneBeats.bulkAdd(ex.sceneBeats);
                    if (ex.aiChats.length) await db.aiChats.bulkAdd(ex.aiChats);
                }
                if (data.notes.length) await db.notes.bulkAdd(data.notes);
                if (data.userPrompts.length) await db.prompts.bulkAdd(data.userPrompts);
                if (data.userTemplates.length) await db.templates.bulkAdd(data.userTemplates);
                if (data.aiSettings) await db.aiSettings.add(data.aiSettings);
            },
        );

        // Force AIService to reload its in-memory settings from the fresh row.
        await aiService.initialize();

        return { stories: data.stories.length };
    },
};
