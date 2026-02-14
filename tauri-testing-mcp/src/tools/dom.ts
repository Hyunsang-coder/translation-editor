import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function registerDomTools(
  server: McpServer,
  callBridge: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): void {
  server.registerTool(
    "tauri_dom_query_selector",
    {
      description: "Find a single element by CSS selector.",
      inputSchema: {
        selector: z.string(),
        index: z.number().int().nonnegative().optional(),
        label: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ selector, index, label }) => textResult(await callBridge("dom.querySelector", { selector, index, label })),
  );

  server.registerTool(
    "tauri_dom_click",
    {
      description: "Click an element by CSS selector.",
      inputSchema: {
        selector: z.string(),
        index: z.number().int().nonnegative().optional(),
        label: z.string().optional(),
      },
    },
    async ({ selector, index, label }) => textResult(await callBridge("dom.click", { selector, index, label })),
  );

  server.registerTool(
    "tauri_dom_click_by_text",
    {
      description: "Click a button/option by visible text.",
      inputSchema: {
        text: z.string(),
        exact: z.boolean().optional(),
        visibleOnly: z.boolean().optional(),
        selector: z.string().optional(),
        label: z.string().optional(),
      },
    },
    async ({ text, exact, visibleOnly, selector, label }) =>
      textResult(await callBridge("dom.clickByText", { text, exact, visibleOnly, selector, label })),
  );

  server.registerTool(
    "tauri_dom_fill",
    {
      description: "Fill an input or textarea by CSS selector.",
      inputSchema: {
        selector: z.string(),
        value: z.string(),
        index: z.number().int().nonnegative().optional(),
        label: z.string().optional(),
      },
    },
    async ({ selector, value, index, label }) => textResult(await callBridge("dom.fill", { selector, value, index, label })),
  );

  server.registerTool(
    "tauri_dom_fill_by_placeholder",
    {
      description: "Fill input/textarea by placeholder text.",
      inputSchema: {
        placeholder: z.string(),
        value: z.string(),
        exact: z.boolean().optional(),
        label: z.string().optional(),
      },
    },
    async ({ placeholder, value, exact, label }) =>
      textResult(await callBridge("dom.fillByPlaceholder", { placeholder, value, exact, label })),
  );

  server.registerTool(
    "tauri_dom_type_contenteditable",
    {
      description: "Type text into contenteditable element by index.",
      inputSchema: {
        value: z.string(),
        index: z.number().int().nonnegative().optional(),
        clear: z.boolean().optional(),
        label: z.string().optional(),
      },
    },
    async ({ value, index, clear, label }) =>
      textResult(await callBridge("dom.typeContentEditable", { value, index, clear, label })),
  );

  server.registerTool(
    "tauri_dom_type_contenteditable_by_selector",
    {
      description: "Type text into contenteditable element by selector.",
      inputSchema: {
        selector: z.string(),
        value: z.string(),
        index: z.number().int().nonnegative().optional(),
        clear: z.boolean().optional(),
        label: z.string().optional(),
      },
    },
    async ({ selector, value, index, clear, label }) =>
      textResult(await callBridge("dom.typeContentEditableBySelector", { selector, value, index, clear, label })),
  );

  server.registerTool(
    "tauri_dom_get_text",
    {
      description: "Get trimmed text content for an element.",
      inputSchema: {
        selector: z.string(),
        index: z.number().int().nonnegative().optional(),
        label: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ selector, index, label }) => textResult(await callBridge("dom.getText", { selector, index, label })),
  );

  server.registerTool(
    "tauri_dom_wait_for_selector",
    {
      description: "Wait until an element appears.",
      inputSchema: {
        selector: z.string(),
        timeout: z.number().int().positive().max(120000).optional(),
        visible: z.boolean().optional(),
        label: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ selector, timeout, visible, label }) =>
      textResult(await callBridge("dom.waitForSelector", { selector, timeout, visible, label })),
  );

  server.registerTool(
    "tauri_dom_wait_for_text",
    {
      description: "Wait until visible text appears in the DOM.",
      inputSchema: {
        text: z.string(),
        timeout: z.number().int().positive().max(120000).optional(),
        exact: z.boolean().optional(),
        selector: z.string().optional(),
        label: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ text, timeout, exact, selector, label }) =>
      textResult(await callBridge("dom.waitForText", { text, timeout, exact, selector, label })),
  );

  server.registerTool(
    "tauri_dom_get_page_content",
    {
      description: "Get simplified DOM tree from current page.",
      inputSchema: {
        maxDepth: z.number().int().positive().max(20).optional(),
        maxNodes: z.number().int().positive().max(5000).optional(),
        selector: z.string().optional(),
        label: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ maxDepth, maxNodes, selector, label }) =>
      textResult(await callBridge("dom.getPageContent", { maxDepth, maxNodes, selector, label })),
  );

  server.registerTool(
    "tauri_dom_get_all",
    {
      description: "Get info about all elements matching a CSS selector (tag, text, visible, disabled, checked).",
      inputSchema: {
        selector: z.string(),
        limit: z.number().int().positive().max(100).optional(),
        label: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ selector, limit, label }) =>
      textResult(await callBridge("dom.getAll", { selector, limit, label })),
  );

  server.registerTool(
    "tauri_dom_get_value",
    {
      description: "Get current value of an input, textarea, select, or contenteditable element.",
      inputSchema: {
        selector: z.string(),
        index: z.number().int().nonnegative().optional(),
        label: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ selector, index, label }) =>
      textResult(await callBridge("dom.getValue", { selector, index, label })),
  );

  server.registerTool(
    "tauri_dom_select",
    {
      description: "Select an option in a <select> element by value, text, or optionIndex.",
      inputSchema: {
        selector: z.string(),
        value: z.string().optional(),
        text: z.string().optional(),
        optionIndex: z.number().int().nonnegative().optional(),
        exact: z.boolean().optional(),
        index: z.number().int().nonnegative().optional(),
        label: z.string().optional(),
      },
    },
    async ({ selector, value, text, optionIndex, exact, index, label }) =>
      textResult(await callBridge("dom.select", { selector, value, text, optionIndex, exact, index, label })),
  );

  server.registerTool(
    "tauri_dom_keyboard",
    {
      description: "Send keyboard event (keydown + keyup). Supports modifiers for shortcuts (e.g. Cmd+L).",
      inputSchema: {
        key: z.string().describe("Key value, e.g. 'Enter', 'Escape', 'a', 'l'"),
        code: z.string().optional().describe("Physical key code, e.g. 'KeyL', 'Enter'"),
        modifiers: z.array(z.enum(["ctrl", "meta", "cmd", "shift", "alt"])).optional(),
        selector: z.string().optional().describe("Target element; defaults to active element"),
        label: z.string().optional(),
      },
    },
    async ({ key, code, modifiers, selector, label }) =>
      textResult(await callBridge("dom.keyboard", { key, code, modifiers, selector, label })),
  );

  server.registerTool(
    "tauri_dom_scroll_to",
    {
      description: "Scroll to an element (by selector) or to absolute coordinates.",
      inputSchema: {
        selector: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        position: z.enum(["start", "center", "end", "nearest"]).optional(),
        label: z.string().optional(),
      },
    },
    async ({ selector, x, y, position, label }) =>
      textResult(await callBridge("dom.scrollTo", { selector, x, y, position, label })),
  );

  server.registerTool(
    "tauri_dom_wait_for_hidden",
    {
      description: "Wait until an element disappears or becomes invisible.",
      inputSchema: {
        selector: z.string(),
        timeout: z.number().int().positive().max(120000).optional(),
        label: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ selector, timeout, label }) =>
      textResult(await callBridge("dom.waitForHidden", { selector, timeout, label })),
  );

  server.registerTool(
    "tauri_dialog_get_state",
    {
      description: "Read captured confirm/alert/prompt and tauri dialog events.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => textResult(await callBridge("dialog.getState", {})),
  );

  server.registerTool(
    "tauri_dialog_set_auto_response",
    {
      description: "Set automatic responses for confirm/prompt and tauri plugin dialogs.",
      inputSchema: {
        confirm: z.boolean().optional(),
        promptText: z.string().nullable().optional(),
        tauriAsk: z.boolean().optional(),
        tauriConfirm: z.boolean().optional(),
        clearHistory: z.boolean().optional(),
      },
    },
    async ({ confirm, promptText, tauriAsk, tauriConfirm, clearHistory }) =>
      textResult(await callBridge("dialog.setAutoResponse", { confirm, promptText, tauriAsk, tauriConfirm, clearHistory })),
  );

  server.registerTool(
    "tauri_dialog_push_response",
    {
      description: "Queue one-time dialog response consumed by next confirm/prompt dialog.",
      inputSchema: {
        kind: z.enum(["confirm", "prompt"]).optional(),
        value: z.union([z.boolean(), z.string(), z.null()]).optional(),
      },
    },
    async ({ kind, value }) =>
      textResult(await callBridge("dialog.pushResponse", { kind, value })),
  );

  server.registerTool(
    "tauri_dialog_clear",
    {
      description: "Clear captured dialog history and optionally keep queued responses.",
      inputSchema: {
        keepQueue: z.boolean().optional(),
      },
    },
    async ({ keepQueue }) =>
      textResult(await callBridge("dialog.clear", { keepQueue })),
  );
}
