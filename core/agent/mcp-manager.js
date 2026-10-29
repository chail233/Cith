import {StdioClientTransport, getDefaultEnvironment} from "@modelcontextprotocol/client/stdio";
import {Client, StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import {SSEClientTransport} from "@modelcontextprotocol/sdk/client/sse.js";
import config from "../config.js";
import logger from "../utils/logger.js";

// provider 对函数名的硬上限，超长会整批拒绝
const MAX_TOOL_NAME_LENGTH = 64;
const TOOL_NAME_PREFIX = "mcp_";
// 前缀之外的 key 预算
const MAX_KEY_LENGTH = MAX_TOOL_NAME_LENGTH - TOOL_NAME_PREFIX.length;
const MAX_TOOL_PART_LENGTH = 40;

function sanitizeName(name) {
    return String(name).replace(/[^a-zA-Z0-9_-]/g, "_");
}

// key = 服务器名_工具名，只做清洗和必要截断；路由靠 toolServerMap 反查，不解析名字
function toolKey(serverName, toolName) {
    const server = sanitizeName(serverName);
    const tool = sanitizeName(toolName).slice(0, MAX_TOOL_PART_LENGTH);
    return `${server.slice(0, Math.max(MAX_KEY_LENGTH - 1 - tool.length, 1))}_${tool}`;
}
class McpConnection{
    constructor(serverConfig, logger) {
        this.logger = logger;
        this.name = serverConfig.name;
        this.config = serverConfig;
        this.client = null;
    }


    async connect(){
        const transportType = this.config.transport ?? "stdio";
        let transport;
        if(transportType==="stdio"){
            transport = new StdioClientTransport(
                {
                    command:this.config.command,
                    args:this.config.args ?? [],
                    env: { ...process.env, ...getDefaultEnvironment(), ...(this.config.env ?? {}) },
                }
            );
        }
        else if(transportType==="old_sse"){
            const transportOptions = {};
            if (this.config.headers) {
                transportOptions.requestInit = {
                    headers: this.config.headers,
                };
            }
            transport = new SSEClientTransport(new URL(this.config.url), transportOptions);
        }
        else if(transportType==="sse"){
            const transportOptions = {};
            if (this.config.headers) {
                transportOptions.requestInit = {
                    headers: this.config.headers,
                };
            }
            transport = new StreamableHTTPClientTransport(new URL(this.config.url), transportOptions);
        }
        else {
            this.logger.error(`不支持的传输类型：${transportType}`);
        }

        this.client = new Client(
            {
                name:`SunbatwoBot-${this.name}`,
                version:"1.1.0",
            }
        );

        await this.client.connect(transport);
        this.logger.info(`Connected to MCP Server ${this.name}`);
    }

    async listTools(){
        if(!this.client) return[];
        const result = await this.client.listTools();
        return result.tools;
    }

    async callTool(toolName, args){
        if(!this.client) throw new Error(`MCP Server ${this.name} is not connected`);

        const result = await this.client.callTool({
            name:toolName,
            arguments:args
        });

        if(result.content && Array.isArray(result.content)){
            return result.content
                .filter((item)=>item.type === "text")
                .map((item)=>item.text)
                .join("\n");
        }
        return JSON.stringify(result);
    }

    async close(){
        if(this.client){
            await this.client.close();
            this.client = null;
        }
    }
}


export class McpClientManager{
    constructor(config, logger, connectionFactory = (server) => new McpConnection(server, logger)) {
        this.config = config;
        this.logger = logger;
        this.connectionFactory = connectionFactory;
        this.connections = new Map();
        this.toolServerMap = new Map();
        this.legacyTools = new Map();
        this._toolCache = new Map();
        this.initialized = false;
    }

    async init(){
        const servers = this.config.mcpServers ?? [];
        if(servers.length===0){
            return;
        }
        for(const serverConfig of servers){
            let connection;
            try {
                if (this.connections.has(serverConfig.name)) {
                    this.logger.warn(`MCP服务器名称重复：${serverConfig.name}`);
                    continue;
                }
                connection = this.connectionFactory(serverConfig);
                await connection.connect();
                const tools = await connection.listTools();
                this.connections.set(serverConfig.name, connection);
                this.registerTools(serverConfig.name, tools);
            }
            catch (err){
                if (connection) {
                    try { await connection.close(); }
                    catch (closeErr) { this.logger.error(`关闭MCP连接失败： ${serverConfig.name}`, closeErr); }
                }
                this.connections.delete(serverConfig.name);
                this.logger.error(`MCP连接失败： ${serverConfig.name}`, err);
            }
        }
        this.initialized = true;
        this.logger.info("MCP 客户端初始化完成");
    }

    registerTools(serverName, tools) {
        const entries = tools.map(tool => [toolKey(serverName, tool.name), tool]);
        const seen = new Map();
        for (const [key, tool] of entries) {
            const existing = this.toolServerMap.get(key);
            if ((existing && (existing.serverName !== serverName || existing.toolName !== tool.name)) ||
                (seen.has(key) && seen.get(key) !== tool.name)) {
                throw new Error(`MCP工具名称冲突：${serverName}/${tool.name}`);
            }
            seen.set(key, tool.name);
        }
        for (const [key, route] of this.toolServerMap) {
            if (route.serverName === serverName) {
                this.toolServerMap.delete(key);
                this._toolCache.delete(key);
            }
        }
        for (const [key, tool] of entries) {
            this.toolServerMap.set(key, { serverName, toolName: tool.name });
            this._toolCache.set(key, tool);
            const legacy = this.legacyTools.get(tool.name);
            if (legacy === undefined) this.legacyTools.set(tool.name, key);
            else if (legacy !== key && legacy !== null) {
                this.legacyTools.set(tool.name, null);
                this.logger.warn(`MCP工具同名，旧名称不可用：${tool.name}`);
            }
        }
    }

    definition(key, tool) {
        return { type: "function", function: {
            name: `${TOOL_NAME_PREFIX}${key}`,
            description: tool.description ?? "",
            parameters: tool.inputSchema ?? {},
        }};
    }

    async getToolDefinition(){
        if(!this.initialized) return [];
        const definitions = [];

        for(const [key, { serverName }] of this.toolServerMap){
            const connection = this.connections.get(serverName);
            if(connection){
                const cached = this._toolCache.get(key);
                if(cached){
                    definitions.push(this.definition(key, cached));
                }
            }
        }
        return definitions;
    }

    async getToolDefinitionOfServer(serverName){
        if(!this.initialized) return [];
        const definitions = [];
        if(!this.connections.has(serverName)) return definitions;
        const connection = this.connections.get(serverName);
        if(connection){
            const tools = await connection.listTools();
            this.registerTools(serverName, tools);
            for(const tool of tools){
                definitions.push(this.definition(toolKey(serverName, tool.name), tool));
            }
        }
        return definitions;
    }

    async callTool(toolName, args){
        const direct = this.toolServerMap.get(toolName);
        const legacyKey = this.legacyTools.get(toolName);
        const legacy = this.toolServerMap.get(legacyKey);
        if (direct && (legacyKey === null || (legacy && legacyKey !== toolName))) {
            this.logger.warn(`MCP工具名称有歧义：${toolName}`);
            return `MCP工具 ${toolName} 名称有歧义`;
        }
        const route = direct ?? legacy;
        if(route){
            const { serverName, toolName: originalName } = route;
            const connection = this.connections.get(serverName);
            if(connection){
                this.logger.debug(`调用MCP工具 ${toolName} 参数：`, args);
                return await connection.callTool(originalName, args);
            }
        }
        return `MCP工具 ${toolName} 未找到`;
    }

    async shutdown(){
        for(const [name, connection] of this.connections){
            await connection.close();
            this.logger.info(`关闭MCP连接 ${name}`);
        }
        this.connections.clear();
        this.toolServerMap.clear();
        this.legacyTools.clear();
        this._toolCache?.clear();
        this.initialized = false;
    }

    listServers(){
        return (this.config.mcpServers ?? []).map((server) => {
            return{
                name: server.name,
                description: server.description ?? "",
            }});
    }
}

export const mcpClient = new McpClientManager(config, logger);
