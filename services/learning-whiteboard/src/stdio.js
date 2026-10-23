import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BoardStore } from './store.js';
import { createMcpServer } from './mcp.js';

// Local stdio has no HTTP boundary; the local process and filesystem permissions are its authorization boundary.
// All diagnostic output goes to stderr, preserving stdout exclusively for MCP.
const store = await new BoardStore().initialize();
await createMcpServer(store).connect(new StdioServerTransport());
