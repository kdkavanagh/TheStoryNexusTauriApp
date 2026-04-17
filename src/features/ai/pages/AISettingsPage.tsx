import { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, Loader2 } from "lucide-react";
import { aiService } from '@/services/ai/AIService';
import { globalStateService } from '@/services/globalStateService';
import { toast } from 'react-toastify';
import { AIModel } from '@/types/story';
import { cn } from '@/lib/utils';

export default function AISettingsPage() {
    const [openaiKey, setOpenaiKey] = useState('');
    const [openrouterKey, setOpenrouterKey] = useState('');
    const [claudeKey, setClaudeKey] = useState('');
    const [localApiUrl, setLocalApiUrl] = useState('http://localhost:1234/v1');
    const [isLoading, setIsLoading] = useState(false);
    const [openaiModels, setOpenaiModels] = useState<AIModel[]>([]);
    const [openrouterModels, setOpenrouterModels] = useState<AIModel[]>([]);
    const [claudeModels, setClaudeModels] = useState<AIModel[]>([]);
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
    const [isSyncing, setIsSyncing] = useState(false);

    useEffect(() => {
        loadInitialData();
    }, []);

    const loadInitialData = async () => {
        try {
            console.log('[AISettingsPage] Initializing AI service');
            await aiService.initialize();

            // Set the keys using the new getter methods
            const openaiKey = aiService.getOpenAIKey();
            const openrouterKey = aiService.getOpenRouterKey();
            const claudeKey = aiService.getClaudeKey();
            const localApiUrl = aiService.getLocalApiUrl();

            console.log('[AISettingsPage] Retrieved API keys and URL from service');
            if (openaiKey) setOpenaiKey(openaiKey);
            if (openrouterKey) setOpenrouterKey(openrouterKey);
            if (claudeKey) setClaudeKey(claudeKey);
            if (localApiUrl) setLocalApiUrl(localApiUrl);

            console.log('[AISettingsPage] Getting all available models');
            // Don't force refresh on initial load to avoid unnecessary API calls
            const allModels = await aiService.getAvailableModels(undefined, false);
            console.log(`[AISettingsPage] Received ${allModels.length} total models`);

            const localModels = allModels.filter(m => m.provider === 'local');
            const openaiModels = allModels.filter(m => m.provider === 'openai');
            const openrouterModels = allModels.filter(m => m.provider === 'openrouter');
            const claudeModels = allModels.filter(m => m.provider === 'claude');

            console.log(`[AISettingsPage] Filtered models - Local: ${localModels.length}, OpenAI: ${openaiModels.length}, OpenRouter: ${openrouterModels.length}, Claude: ${claudeModels.length}`);

            setOpenaiModels(openaiModels);
            setOpenrouterModels(openrouterModels);
            setClaudeModels(claudeModels);
        } catch (error) {
            console.error('Error loading AI settings:', error);
            toast.error('Failed to load AI settings');
        }
    };

    const providerLabel = (provider: 'openai' | 'openrouter' | 'claude' | 'local') =>
        provider === 'openai' ? 'OpenAI'
            : provider === 'openrouter' ? 'OpenRouter'
                : provider === 'claude' ? 'Claude'
                    : 'Local';

    const handleKeyUpdate = async (provider: 'openai' | 'openrouter' | 'claude' | 'local', key: string) => {
        if (provider !== 'local' && !key.trim()) return;

        setIsLoading(true);
        console.log(`[AISettingsPage] Updating key for provider: ${provider}`);
        try {
            await aiService.updateKey(provider, key);
            console.log(`[AISettingsPage] Key updated for ${provider}, fetching models`);
            const models = await aiService.getAvailableModels(provider);
            console.log(`[AISettingsPage] Received ${models.length} models for ${provider}`);

            if (provider === 'openai') {
                setOpenaiModels(models);
                setOpenSections(prev => ({ ...prev, openai: true }));
            } else if (provider === 'openrouter') {
                setOpenrouterModels(models);
                setOpenSections(prev => ({ ...prev, openrouter: true }));
            } else if (provider === 'claude') {
                setClaudeModels(models);
                setOpenSections(prev => ({ ...prev, claude: true }));
            } else if (provider === 'local') {
                console.log(`[AISettingsPage] Updating local models, received ${models.length} models`);
                setOpenaiModels(prev => {
                    const filtered = prev.filter(m => m.provider !== 'local');
                    console.log(`[AISettingsPage] Filtered out ${prev.length - filtered.length} old local models`);
                    const newModels = [...filtered, ...models];
                    console.log(`[AISettingsPage] New models array has ${newModels.length} models`);
                    return newModels;
                });
                setOpenSections(prev => ({ ...prev, local: true }));
            }

            toast.success(`${providerLabel(provider)} models updated successfully`);
        } catch (error) {
            toast.error(`Failed to update ${provider} models`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRefreshModels = async (provider: 'openai' | 'openrouter' | 'claude' | 'local') => {
        setIsLoading(true);
        console.log(`[AISettingsPage] Refreshing models for provider: ${provider}`);
        try {
            // Force refresh by passing true as the second parameter
            const models = await aiService.getAvailableModels(provider, true);
            console.log(`[AISettingsPage] Received ${models.length} models for ${provider}`);

            switch (provider) {
                case 'openai':
                    setOpenaiModels(models);
                    setOpenSections(prev => ({ ...prev, openai: true }));
                    break;
                case 'openrouter':
                    setOpenrouterModels(models);
                    setOpenSections(prev => ({ ...prev, openrouter: true }));
                    break;
                case 'claude':
                    setClaudeModels(models);
                    setOpenSections(prev => ({ ...prev, claude: true }));
                    break;
                case 'local':
                    console.log(`[AISettingsPage] Updating local models, received ${models.length} models`);
                    setOpenaiModels(prev => {
                        const filtered = prev.filter(m => m.provider !== 'local');
                        console.log(`[AISettingsPage] Filtered out ${prev.length - filtered.length} old local models`);
                        const newModels = [...filtered, ...models];
                        console.log(`[AISettingsPage] New models array has ${newModels.length} models`);
                        return newModels;
                    });
                    setOpenSections(prev => ({ ...prev, local: true }));
                    break;
            }

            toast.success(`${providerLabel(provider)} models refreshed`);
        } catch (error) {
            console.error(`Error refreshing ${provider} models:`, error);
            toast.error(`Failed to refresh ${provider} models`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleLocalApiUrlUpdate = async (url: string) => {
        if (!url.trim()) return;

        setIsLoading(true);
        console.log(`[AISettingsPage] Updating local API URL to: ${url}`);
        try {
            await aiService.updateLocalApiUrl(url);
            console.log(`[AISettingsPage] Local API URL updated, fetching models`);
            // Force refresh by passing true as the second parameter
            const models = await aiService.getAvailableModels('local', true);
            console.log(`[AISettingsPage] Received ${models.length} local models`);

            setOpenaiModels(prev => {
                const filtered = prev.filter(m => m.provider !== 'local');
                console.log(`[AISettingsPage] Filtered out ${prev.length - filtered.length} old local models`);
                const newModels = [...filtered, ...models];
                console.log(`[AISettingsPage] New models array has ${newModels.length} models`);
                return newModels;
            });
            setOpenSections(prev => ({ ...prev, local: true }));

            toast.success('Local API URL updated successfully');
        } catch (error) {
            console.error('Error updating local API URL:', error);
            toast.error('Failed to update local API URL');
        } finally {
            setIsLoading(false);
        }
    };

    const toggleSection = (section: string) => {
        setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
    };

    const handleSaveToServer = async () => {
        setIsSyncing(true);
        try {
            const { bytes } = await globalStateService.saveToServer();
            toast.success(`Saved global state to server (${(bytes / 1024).toFixed(1)} KB)`);
        } catch (error) {
            console.error('Save to server failed:', error);
            toast.error(`Save failed: ${(error as Error).message}`);
        } finally {
            setIsSyncing(false);
        }
    };

    const handleLoadFromServer = async () => {
        const confirmed = window.confirm(
            'Load will REPLACE your current browser state (stories, prompts, AI settings) with the copy saved on the server. Continue?'
        );
        if (!confirmed) return;

        setIsSyncing(true);
        try {
            const { stories } = await globalStateService.loadFromServer();
            toast.success(`Loaded global state from server (${stories} stories)`);
            // Reload so every component re-reads from the now-replaced Dexie tables.
            window.location.reload();
        } catch (error) {
            console.error('Load from server failed:', error);
            toast.error(`Load failed: ${(error as Error).message}`);
            setIsSyncing(false);
        }
    };

    return (
        <div className="p-8">
            <div className="max-w-2xl mx-auto">
                <h1 className="text-3xl font-bold mb-8">AI Settings</h1>

                <div className="space-y-6">
                    {/* Server Sync Section */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Server Sync</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                Save your stories, AI settings, and custom prompts to a JSON file on the dev server,
                                then restore them in any browser that points at the same dev server.
                                Load will replace the current browser's local state.
                            </p>
                            <div className="flex gap-2">
                                <Button onClick={handleSaveToServer} disabled={isSyncing}>
                                    {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save to Server'}
                                </Button>
                                <Button variant="outline" onClick={handleLoadFromServer} disabled={isSyncing}>
                                    {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load from Server'}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* OpenAI Section */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex justify-between items-center">
                                OpenAI Configuration
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleRefreshModels('openai')}
                                    disabled={isLoading || !openaiKey.trim()}
                                >
                                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh Models'}
                                </Button>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-2">
                                <Label htmlFor="openai-key">OpenAI API Key</Label>
                                <div className="flex gap-2">
                                    <Input
                                        id="openai-key"
                                        type="password"
                                        placeholder="Enter your OpenAI API key"
                                        value={openaiKey}
                                        onChange={(e) => setOpenaiKey(e.target.value)}
                                    />
                                    <Button
                                        onClick={() => handleKeyUpdate('openai', openaiKey)}
                                        disabled={isLoading || !openaiKey.trim()}
                                    >
                                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                                    </Button>
                                </div>
                            </div>

                            {openaiModels.length > 0 && (
                                <Collapsible
                                    open={openSections.openai}
                                    onOpenChange={() => toggleSection('openai')}
                                >
                                    <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                                        <ChevronRight className={cn(
                                            "h-4 w-4 transition-transform",
                                            openSections.openai && "transform rotate-90"
                                        )} />
                                        Available Models
                                    </CollapsibleTrigger>
                                    <CollapsibleContent className="mt-2 space-y-2">
                                        {openaiModels.map(model => (
                                            <div key={model.id} className="text-sm pl-6">
                                                {model.name}
                                            </div>
                                        ))}
                                    </CollapsibleContent>
                                </Collapsible>
                            )}
                        </CardContent>
                    </Card>

                    {/* OpenRouter Section */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex justify-between items-center">
                                OpenRouter Configuration
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleRefreshModels('openrouter')}
                                    disabled={isLoading || !openrouterKey.trim()}
                                >
                                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh Models'}
                                </Button>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-2">
                                <Label htmlFor="openrouter-key">OpenRouter API Key</Label>
                                <div className="flex gap-2">
                                    <Input
                                        id="openrouter-key"
                                        type="password"
                                        placeholder="Enter your OpenRouter API key"
                                        value={openrouterKey}
                                        onChange={(e) => setOpenrouterKey(e.target.value)}
                                    />
                                    <Button
                                        onClick={() => handleKeyUpdate('openrouter', openrouterKey)}
                                        disabled={isLoading || !openrouterKey.trim()}
                                    >
                                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                                    </Button>
                                </div>
                            </div>

                            {openrouterModels.length > 0 && (
                                <Collapsible
                                    open={openSections.openrouter}
                                    onOpenChange={() => toggleSection('openrouter')}
                                >
                                    <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                                        <ChevronRight className={cn(
                                            "h-4 w-4 transition-transform",
                                            openSections.openrouter && "transform rotate-90"
                                        )} />
                                        Available Models
                                    </CollapsibleTrigger>
                                    <CollapsibleContent className="mt-2 space-y-2">
                                        {openrouterModels.map(model => (
                                            <div key={model.id} className="text-sm pl-6">
                                                {model.name}
                                            </div>
                                        ))}
                                    </CollapsibleContent>
                                </Collapsible>
                            )}
                        </CardContent>
                    </Card>

                    {/* Claude Section */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex justify-between items-center">
                                Claude Configuration
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleRefreshModels('claude')}
                                    disabled={isLoading || !claudeKey.trim()}
                                >
                                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh Models'}
                                </Button>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-2">
                                <Label htmlFor="claude-key">Claude API Key</Label>
                                <div className="flex gap-2">
                                    <Input
                                        id="claude-key"
                                        type="password"
                                        placeholder="Enter your Claude API key"
                                        value={claudeKey}
                                        onChange={(e) => setClaudeKey(e.target.value)}
                                    />
                                    <Button
                                        onClick={() => handleKeyUpdate('claude', claudeKey)}
                                        disabled={isLoading || !claudeKey.trim()}
                                    >
                                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                                    </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Uses the Anthropic Messages API at https://api.anthropic.com/v1
                                </p>
                            </div>

                            {claudeModels.length > 0 && (
                                <Collapsible
                                    open={openSections.claude}
                                    onOpenChange={() => toggleSection('claude')}
                                >
                                    <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                                        <ChevronRight className={cn(
                                            "h-4 w-4 transition-transform",
                                            openSections.claude && "transform rotate-90"
                                        )} />
                                        Available Models
                                    </CollapsibleTrigger>
                                    <CollapsibleContent className="mt-2 space-y-2">
                                        {claudeModels.map(model => (
                                            <div key={model.id} className="text-sm pl-6">
                                                {model.name}
                                            </div>
                                        ))}
                                    </CollapsibleContent>
                                </Collapsible>
                            )}
                        </CardContent>
                    </Card>

                    {/* Local Models Section */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex justify-between items-center">
                                Local Models
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleRefreshModels('local')}
                                    disabled={isLoading}
                                >
                                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh Models'}
                                </Button>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-muted-foreground">Models from LM Studio</span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleKeyUpdate('local', '')}
                                    disabled={isLoading}
                                >
                                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh Models'}
                                </Button>
                            </div>

                            <Collapsible
                                open={openSections.localAdvanced}
                                onOpenChange={() => toggleSection('localAdvanced')}
                            >
                                <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                                    <ChevronRight className={cn(
                                        "h-4 w-4 transition-transform",
                                        openSections.localAdvanced && "transform rotate-90"
                                    )} />
                                    Advanced Settings
                                </CollapsibleTrigger>
                                <CollapsibleContent className="mt-2 space-y-2">
                                    <div className="grid gap-2">
                                        <Label htmlFor="local-api-url">Local API URL</Label>
                                        <div className="flex gap-2">
                                            <Input
                                                id="local-api-url"
                                                type="text"
                                                placeholder="http://localhost:1234/v1"
                                                value={localApiUrl}
                                                onChange={(e) => setLocalApiUrl(e.target.value)}
                                            />
                                            <Button
                                                onClick={() => handleLocalApiUrlUpdate(localApiUrl)}
                                                disabled={isLoading || !localApiUrl.trim()}
                                            >
                                                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                                            </Button>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            The URL of your local LLM server. Default is http://localhost:1234/v1
                                        </p>
                                    </div>
                                </CollapsibleContent>
                            </Collapsible>

                            <Collapsible
                                open={openSections.local}
                                onOpenChange={() => toggleSection('local')}
                            >
                                <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                                    <ChevronRight className={cn(
                                        "h-4 w-4 transition-transform",
                                        openSections.local && "transform rotate-90"
                                    )} />
                                    Available Models
                                </CollapsibleTrigger>
                                <CollapsibleContent className="mt-2 space-y-2">
                                    {openaiModels
                                        .filter(m => m.provider === 'local')
                                        .map(model => (
                                            <div key={model.id} className="text-sm pl-6">
                                                {model.name}
                                            </div>
                                        ))}
                                </CollapsibleContent>
                            </Collapsible>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
} 