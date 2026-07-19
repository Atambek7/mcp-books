import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
    name: "book-mcp",
    version: "1.0.0",
});

server.registerTool(
    "hello",
    {
        title: "Hello",
        description: "Проверка работы MCP",
        inputSchema: {
            name: z.string().optional(),
        },
    },
    async ({ name }) => {
        return {
            content: [
                {
                    type: "text",
                    text: `Привет ${name ?? "мир"}!`,
                },
            ],
        };
    }
);

const transport = new StdioServerTransport();

await server.connect(transport);