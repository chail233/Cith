import config from "../config.js";
import logger from "../utils/logger.js";
import { McpClientManager } from "./mcp-manager.js";

export const mcpClient = new McpClientManager(config, logger);
