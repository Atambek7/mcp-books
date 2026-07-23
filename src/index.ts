import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import util from "util";

const execPromise = util.promisify(exec);

// Настройка парсера XML для OPDS
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
});

const server = new Server(
    {
        name: "mcp-books-flibusta",
        version: "1.2.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// 1. Регистрируем доступные инструменты
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "search_books",
                description: "Поиск книг на Флибусте по названию или автору",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "Поисковый запрос (например, название книги или имя автора)",
                        },
                    },
                    required: ["query"],
                },
            },
            {
                name: "download_book",
                description: "Скачивает книгу по прямой ссылке с Флибусты в формате epub и сохраняет в корень проекта",
                inputSchema: {
                    type: "object",
                    properties: {
                        url: {
                            type: "string",
                            description: "Прямая ссылка на скачивание (из результатов инструмента search_books)",
                        },
                        filename: {
                            type: "string",
                            description: "Название файла для сохранения (например, dune.epub)",
                        },
                    },
                    required: ["url", "filename"],
                },
            },
            {
                name: "process_and_sort_book",
                description: "Конвертирует EPUB в PDF и перемещает файл в нужную тематическую папку внутри HUMAN/Человек",
                inputSchema: {
                    type: "object",
                    properties: {
                        filename: {
                            type: "string",
                            description: "Имя файла, который уже скачан и лежит в корне проекта (например, courage_to_be.epub)",
                        },
                        category: {
                            type: "string",
                            description: "Тематическая папка (например: Вера, Духовность, Семья, Мышление)",
                        },
                        convertToPdf: {
                            type: "boolean",
                            description: "Если true, конвертирует в PDF перед перемещением. Если false, просто перемещает EPUB.",
                        }
                    },
                    required: ["filename", "category"],
                },
            }
        ],
    };
});

// 2. Обрабатываем вызов инструментов
server.setRequestHandler(CallToolRequestSchema, async (request) => {

    // ==========================================
    // ИНСТРУМЕНТ 1: ПОИСК КНИГ
    // ==========================================
    if (request.params.name === "search_books") {
        const query = request.params.arguments?.query as string;
        if (!query) throw new Error("Missing query argument");

        try {
            const response = await axios.get(`https://flibusta.is/opds/search`, {
                params: { searchType: "books", searchTerm: query },
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MCP-Books/1.0" },
            });

            const jsonObj = parser.parse(response.data);
            const entries = jsonObj.feed?.entry;

            if (!entries) {
                return { content: [{ type: "text", text: `По запросу "${query}" ничего не найдено.` }] };
            }

            const bookList = Array.isArray(entries) ? entries : [entries];

            const results = bookList.map((entry: any) => {
                const title = entry.title;
                const author = Array.isArray(entry.author)
                    ? entry.author.map((a: any) => a.name).join(", ")
                    : entry.author?.name || "Неизвестный автор";

                const links = Array.isArray(entry.link) ? entry.link : [entry.link];
                const downloadLinks = links
                    .filter((l: any) => l["@_type"]?.includes("application/"))
                    .map((l: any) => {
                        const format = l["@_type"].split("/").pop() || "link";
                        const url = l["@_href"].startsWith("http") ? l["@_href"] : `https://flibusta.is${l["@_href"]}`;
                        return `- [${format}]: ${url}`;
                    })
                    .join("\n");

                return `Название: ${title}\nАвтор: ${author}\nСсылки для скачивания:\n${downloadLinks}`;
            });

            return {
                content: [{ type: "text", text: `Результаты поиска для "${query}":\n\n${results.join("\n\n---\n\n")}` }],
            };
        } catch (error: any) {
            return { isError: true, content: [{ type: "text", text: `Ошибка поиска: ${error.message}` }] };
        }
    }

    // ==========================================
    // ИНСТРУМЕНТ 2: СКАЧИВАНИЕ КНИГИ
    // ==========================================
    if (request.params.name === "download_book") {
        const url = request.params.arguments?.url as string;
        let filename = request.params.arguments?.filename as string;

        if (!url || !filename) throw new Error("Missing url or filename");
        if (!filename.endsWith('.epub')) filename += '.epub';

        try {
            // Сохраняем прямо в корень проекта, чтобы потом было удобно конвертировать
            const filePath = path.join(process.cwd(), filename);

            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MCP-Books/1.0" },
            });

            fs.writeFileSync(filePath, response.data);

            return {
                content: [{ type: "text", text: `✅ Книга успешно скачана!\nФайл ${filename} сохранен в корне проекта. Теперь можно использовать инструмент process_and_sort_book.` }],
            };
        } catch (error: any) {
            return { isError: true, content: [{ type: "text", text: `Ошибка при скачивании файла: ${error.message}` }] };
        }
    }

    // ==========================================
    // ИНСТРУМЕНТ 3: КОНВЕРТАЦИЯ И СОРТИРОВКА
    // ==========================================
    if (request.params.name === "process_and_sort_book") {
        const filename = request.params.arguments?.filename as string;
        const category = request.params.arguments?.category as string;
        const convertToPdf = request.params.arguments?.convertToPdf as boolean ?? true;

        if (!filename || !category) throw new Error("Missing filename or category");

        try {
            const sourcePath = path.join(process.cwd(), filename);
            const targetDir = path.join(process.cwd(), "HUMAN", "Человек", category);

            if (!fs.existsSync(sourcePath)) {
                return { isError: true, content: [{ type: "text", text: `Файл ${filename} не найден в корне проекта.` }] };
            }

            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            let finalFilePath = path.join(targetDir, filename);
            let message = "";

            if (convertToPdf && filename.endsWith(".epub")) {
                const pdfFilename = filename.replace(".epub", ".pdf");
                const pdfTargetPath = path.join(targetDir, pdfFilename);

                // Запускаем консольную утилиту Calibre
                await execPromise(`ebook-convert "${sourcePath}" "${pdfTargetPath}"`);

                // Удаляем оригинальный epub
                fs.unlinkSync(sourcePath);

                message = `✅ Файл ${filename} успешно конвертирован в PDF и перемещен в папку: ${targetDir}`;
            } else {
                // Просто перемещаем, если конвертация не нужна
                fs.renameSync(sourcePath, finalFilePath);
                message = `✅ Файл ${filename} успешно перемещен в папку: ${targetDir}`;
            }

            return {
                content: [{ type: "text", text: message }],
            };

        } catch (error: any) {
            return { isError: true, content: [{ type: "text", text: `Ошибка при обработке файла: ${error.message}. Убедитесь, что установлена программа Calibre.` }] };
        }
    }

    throw new Error(`Unknown tool: ${request.params.name}`);
});

async function run() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Flibusta MCP Server is running!");
}

run();