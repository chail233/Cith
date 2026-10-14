import {StdioClientTransport, getDefaultEnvironment} from "@modelcontextprotocol/client/stdio";
import {Client, StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import {SSEClientTransport} from "@modelcontextprotocol/sdk/client/sse.js";
import logger from "../utils/logger.js";
import config from "../config.js";

class McpConnection{
    constructor(serverConfig) {
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
            logger.error(`不支持的传输类型：${transportType}`);
        }

        this.client = new Client(
            {
                name:`SunbatwoBot-${this.name}`,
                version:"1.1.0",
            }
        );

        await this.client.connect(transport);
        logger.info(`Connected to MCP Server ${this.name}`);
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


class McpClientManager{
    constructor() {
        this.connections = new Map();
        this.toolServerMap = new Map();
        this.initialized = false;
    }

    async init(){
        const servers = config.mcpServers ?? [];
        if(servers.length===0){
            return;
        }
        this._toolCache = new Map();
        for(const serverConfig of servers){
            try {
                const connection = new McpConnection(serverConfig);
                await connection.connect();

                const tools = await connection.listTools();
                for(const tool of tools){
                    this.toolServerMap.set(tool.name, serverConfig.name);
                    this._toolCache.set(tool.name, tool);
                }
                this.connections.set(serverConfig.name, connection);
            }
            catch (err){
                logger.error(`MCP连接失败： ${serverConfig.name}`, err);
            }
        }
        this.initialized = true;
        logger.info("MCP 客户端初始化完成");
    }

    async getToolDefinition(){
        if(!this.initialized) return [];
        const definitions = [];

        for(const [toolName, serverName] of this.toolServerMap){
            const connection = this.connections.get(serverName);
            if(connection){
                const cached = this._toolCache?.get(toolName);
                if(cached){
                    definitions.push({
                       type:"function",
                       function:{
                           name:`mcp_${toolName}`,
                           description:cached.description ?? "",
                           parameters:cached.inputSchema ?? {},
                       },
                    });
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
            for(const tool of tools){
                definitions.push({
                    type:"function",
                    function:{
                        name:`mcp_${tool.name}`,
                        description:tool.description ?? "",
                        parameters:tool.inputSchema ?? {},
                    },
                });
            }
        }
        return definitions;
    }

    async callTool(toolName, args){
        const serverName = this.toolServerMap.get(toolName);
        if(serverName){
            const connection = this.connections.get(serverName);
            if(connection){
                logger.debug(`调用MCP工具 ${toolName} 参数：`, args);
                return await connection.callTool(toolName, args);
            }
        }
        return `MCP工具 ${toolName} 未找到`;
    }

    async shutdown(){
        for(const [name, connection] of this.connections){
            await connection.close();
            logger.info(`关闭MCP连接 ${name}`);
        }
        this.connections.clear();
        this.toolServerMap.clear();
        this._toolCache?.clear();
        this.initialized = false;
    }

    listServers(){
        return config.mcpServers.map((server) => {
            return{
                name: server.name,
                description: server.description ?? "",
            }});
    }
}

export const mcpClient = new McpClientManager();