import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BrowserEngine } from "../daemon/BrowserEngine.js";
import { SessionManager } from "../daemon/SessionManager.js";

export async function McpCommand() {
  const browser = await BrowserEngine.launch();
  const sessionManager = new SessionManager(browser, { maxSessions: 10 });

  const server = new McpServer({ name: "aux4-browser", version: "1.0.0" });

  server.tool("open", "Open a new browser session", {
    url: z.string().optional().describe("URL to navigate to"),
    timeout: z.string().optional().describe("Session timeout (e.g. 10m, 1h)"),
    width: z.number().optional().describe("Viewport width"),
    height: z.number().optional().describe("Viewport height")
  }, async (params) => {
    const result = await sessionManager.open(params);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("close", "Close a browser session", {
    session: z.string().describe("Session ID")
  }, async (params) => {
    const result = await sessionManager.close(params.session);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("list", "List active browser sessions", {}, async () => {
    const result = sessionManager.list();
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("visit", "Navigate to a URL", {
    session: z.string().describe("Session ID"),
    url: z.string().describe("URL to navigate to")
  }, async (params) => {
    const result = await sessionManager.visit(params.session, params.url);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("back", "Go back in browser history", {
    session: z.string().describe("Session ID")
  }, async (params) => {
    const result = await sessionManager.back(params.session);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("forward", "Go forward in browser history", {
    session: z.string().describe("Session ID")
  }, async (params) => {
    const result = await sessionManager.forward(params.session);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("reload", "Reload the current page", {
    session: z.string().describe("Session ID")
  }, async (params) => {
    const result = await sessionManager.reload(params.session);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("click", "Click an element by role and name", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Accessible name of the element"),
    role: z.string().optional().describe("ARIA role (default: button)")
  }, async (params) => {
    const result = await sessionManager.click(params.session, params);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("type", "Type text into an input field", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Accessible name of the field"),
    value: z.string().describe("Text to type"),
    role: z.string().optional().describe("ARIA role (default: textbox)")
  }, async (params) => {
    const result = await sessionManager.type(params.session, params);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("scroll", "Scroll the page", {
    session: z.string().describe("Session ID"),
    direction: z.enum(["up", "down"]).optional().describe("Scroll direction (default: down)"),
    amount: z.number().optional().describe("Scroll amount in pixels (default: 500)")
  }, async (params) => {
    const result = await sessionManager.scroll(params.session, params);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("content", "Get page content", {
    session: z.string().describe("Session ID"),
    selector: z.string().optional().describe("CSS selector (default: full page)"),
    format: z.enum(["markdown", "html", "text"]).optional().describe("Output format (default: markdown)")
  }, async (params) => {
    const result = await sessionManager.content(params.session, params);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("screenshot", "Take a screenshot", {
    session: z.string().describe("Session ID"),
    output: z.string().optional().describe("Output file path"),
    fullPage: z.boolean().optional().describe("Capture full page")
  }, async (params) => {
    const result = await sessionManager.screenshot(params.session, params);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("wait", "Wait for a selector to appear", {
    session: z.string().describe("Session ID"),
    selector: z.string().describe("CSS selector to wait for"),
    timeout: z.number().optional().describe("Timeout in ms (default: 5000)")
  }, async (params) => {
    const result = await sessionManager.wait(params.session, params);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("eval", "Evaluate JavaScript in the page", {
    session: z.string().describe("Session ID"),
    script: z.string().describe("JavaScript code to evaluate")
  }, async (params) => {
    const result = await sessionManager.evaluate(params.session, params.script);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("expect", "Assert expectations on page elements", {
    session: z.string().describe("Session ID"),
    selector: z.string().describe("CSS selector"),
    assertion: z.enum(["have_text", "be_visible", "exist"]).describe("Assertion type"),
    expected: z.string().optional().describe("Expected text (for have_text assertion)"),
    timeout: z.string().optional().describe("Timeout in ms (default: 5000)")
  }, async (params) => {
    const result = await sessionManager.expect(params.session, params);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("execute", "Execute a batch of instructions", {
    session: z.string().describe("Session ID"),
    instructions: z.array(z.object({
      method: z.string(),
      params: z.record(z.string()).optional()
    })).describe("Array of {method, params} instructions")
  }, async (params) => {
    const result = await sessionManager.execute(params.session, params.instructions);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("cookies", "Manage cookies", {
    session: z.string().describe("Session ID"),
    export: z.string().optional().describe("Export cookies to file"),
    import: z.string().optional().describe("Import cookies from file")
  }, async (params) => {
    const result = await sessionManager.cookies(params.session, params);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("download", "Download a file", {
    session: z.string().describe("Session ID"),
    url: z.string().describe("URL to download"),
    output: z.string().describe("Output file path")
  }, async (params) => {
    const result = await sessionManager.download(params.session, params);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("new-tab", "Open a new tab", {
    session: z.string().describe("Session ID"),
    url: z.string().optional().describe("URL to open in new tab")
  }, async (params) => {
    const result = await sessionManager.newTab(params.session, params.url);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("switch-tab", "Switch to a tab", {
    session: z.string().describe("Session ID"),
    tab: z.number().describe("Tab index")
  }, async (params) => {
    const result = await sessionManager.switchTab(params.session, params.tab);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("close-tab", "Close a tab", {
    session: z.string().describe("Session ID"),
    tab: z.number().describe("Tab index")
  }, async (params) => {
    const result = await sessionManager.closeTab(params.session, params.tab);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("list-tabs", "List tabs in a session", {
    session: z.string().describe("Session ID")
  }, async (params) => {
    const result = sessionManager.listTabs(params.session);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
