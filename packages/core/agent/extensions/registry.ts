import logger from "../../utils/logger.js";
import { createMcpProvider } from "./mcp-provider.ts";
import type { ExtensionOverviewEntry, ExtensionProvider, ExtensionTool } from "../types.ts";


/** 搜索返回的工具卡上限：大 schema 一多会撑爆单轮回复 */
export const SEARCH_LIMIT = 30;
/** 扩展工具执行输出的字符上限 */
export const MAX_OUTPUT_CHARS = 10000;

export class ExtensionRegistry {
    private providers: ExtensionProvider[] = [];

    /** 登记一个扩展工具来源（模块加载期调用） */
    register(provider: ExtensionProvider): void {
        this.providers.push(provider);
    }

    async init(): Promise<void> {
        for (const provider of this.providers) {
            try {
                await provider.init();
            }
            catch (err) {
                logger.error(`扩展工具来源 ${provider.id} 初始化失败:`, err);
            }
        }
    }

    async shutdown(): Promise<void> {
        for (const provider of this.providers) {
            try {
                await provider.shutdown();
            }
            catch (err) {
                logger.error(`扩展工具来源 ${provider.id} 关闭失败:`, err);
            }
        }
    }

    /** 各来源总览：来源 → 工具数 */
    async overview(): Promise<ExtensionOverviewEntry[]> {
        const result: ExtensionOverviewEntry[] = [];
        for (const provider of this.providers) {
            try {
                result.push(...await provider.overview());
            }
            catch (err) {
                logger.error(`扩展工具来源 ${provider.id} 总览失败:`, err);
            }
        }
        return result;
    }

    /**
     * 关键词搜索：子串匹配工具名与描述，名称命中排在描述命中前
     * @returns 工具卡（超 SEARCH_LIMIT 截断）与命中总数
     */
    async search(query: string): Promise<{ tools: ExtensionTool[]; total: number; truncated: boolean }> {
        const q = query.trim().toLowerCase();
        if (!q) return { tools: [], total: 0, truncated: false };
        const all: Array<ExtensionTool & { nameHit: boolean }> = [];
        for (const provider of this.providers) {
            try {
                const tools = await provider.search(q);
                for (const tool of tools) {
                    all.push({ ...tool, nameHit: tool.name.toLowerCase().includes(q) });
                }
            }
            catch (err) {
                logger.error(`扩展工具来源 ${provider.id} 搜索失败:`, err);
            }
        }
        all.sort((a, b) => Number(b.nameHit) - Number(a.nameHit));
        const truncated = all.length > SEARCH_LIMIT;
        const tools = all.slice(0, SEARCH_LIMIT).map(({ nameHit, ...tool }) => tool);
        return { tools, total: all.length, truncated };
    }

    async get(name: string): Promise<ExtensionTool | null> {
        for (const provider of this.providers) {
            try {
                const tool = await provider.get(name);
                if (tool) return tool;
            }
            catch (err) {
                logger.error(`扩展工具来源 ${provider.id} 查询失败:`, err);
            }
        }
        return null;
    }


    async invoke(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
        for (const provider of this.providers) {
            if (!await provider.get(name)) continue;
            const output = await provider.invoke(name, args, signal);
            return truncateOutput(typeof output === "string" ? output : String(output));
        }
        throw new Error(`扩展工具 ${name} 未找到`);
    }
}

function truncateOutput(text: string): string {
    if (text.length <= MAX_OUTPUT_CHARS) return text;
    return text.slice(0, MAX_OUTPUT_CHARS) + `\n…（输出超长已截断，原长度 ${text.length} 字符）`;
}

export const extensionRegistry = new ExtensionRegistry();
extensionRegistry.register(createMcpProvider());
