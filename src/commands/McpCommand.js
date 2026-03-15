import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BrowserEngine } from "../daemon/BrowserEngine.js";
import { SessionManager } from "../daemon/SessionManager.js";

export async function McpCommand() {
  const browser = await BrowserEngine.launch();
  const sessionManager = new SessionManager(browser, { maxSessions: 10 });

  const server = new McpServer({ name: "aux4-browser", version: "1.0.0" });

  const ok = (result) => ({ content: [{ type: "text", text: JSON.stringify(result) }] });

  server.tool("open", "Open a new browser session", {
    url: z.string().optional().describe("URL to navigate to"),
    timeout: z.string().optional().describe("Session timeout (e.g. 10m, 1h)"),
    width: z.number().optional().describe("Viewport width"),
    height: z.number().optional().describe("Viewport height")
  }, async (params) => ok(await sessionManager.open(params)));

  server.tool("close", "Close a browser session", {
    session: z.string().describe("Session ID")
  }, async (params) => ok(await sessionManager.close(params.session)));

  server.tool("list", "List active browser sessions", {}, async () => ok(sessionManager.list()));

  server.tool("visit", "Navigate to a URL", {
    session: z.string().describe("Session ID"),
    url: z.string().describe("URL to navigate to")
  }, async (params) => ok(await sessionManager.visit(params.session, params.url)));

  server.tool("back", "Go back in browser history", {
    session: z.string().describe("Session ID")
  }, async (params) => ok(await sessionManager.back(params.session)));

  server.tool("forward", "Go forward in browser history", {
    session: z.string().describe("Session ID")
  }, async (params) => ok(await sessionManager.forward(params.session)));

  server.tool("reload", "Reload the current page", {
    session: z.string().describe("Session ID")
  }, async (params) => ok(await sessionManager.reload(params.session)));

  server.tool("click", "Click an element by role and name", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Accessible name of the element"),
    role: z.string().optional().describe("ARIA role (default: button)")
  }, async (params) => ok(await sessionManager.click(params.session, params)));

  server.tool("click-selector", "Click an element by CSS selector", {
    session: z.string().describe("Session ID"),
    selector: z.string().describe("CSS selector")
  }, async (params) => ok(await sessionManager.clickSelector(params.session, params)));

  server.tool("click-text", "Click an element by its text content", {
    session: z.string().describe("Session ID"),
    text: z.string().describe("Text content to find and click")
  }, async (params) => ok(await sessionManager.clickText(params.session, params)));

  server.tool("click-item", "Click an item in a list by index or text", {
    session: z.string().describe("Session ID"),
    item: z.string().describe("Item index (1-based) or text to match"),
    selector: z.string().optional().describe("CSS selector for the list container")
  }, async (params) => ok(await sessionManager.clickItem(params.session, params)));

  server.tool("type", "Type text into an input field", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Accessible name of the field"),
    value: z.string().describe("Text to type"),
    role: z.string().optional().describe("ARIA role (default: textbox)")
  }, async (params) => ok(await sessionManager.type(params.session, params)));

  server.tool("select", "Select an option from a dropdown", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Accessible name of the dropdown"),
    value: z.string().describe("Option value to select"),
    role: z.string().optional().describe("ARIA role (default: combobox)")
  }, async (params) => ok(await sessionManager.select(params.session, params)));

  server.tool("check", "Check a checkbox", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Accessible name of the checkbox"),
    role: z.string().optional().describe("ARIA role (default: checkbox)")
  }, async (params) => ok(await sessionManager.check(params.session, params)));

  server.tool("uncheck", "Uncheck a checkbox", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Accessible name of the checkbox"),
    role: z.string().optional().describe("ARIA role (default: checkbox)")
  }, async (params) => ok(await sessionManager.uncheck(params.session, params)));

  server.tool("hover", "Hover over an element", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Accessible name of the element"),
    role: z.string().optional().describe("ARIA role (default: button)")
  }, async (params) => ok(await sessionManager.hover(params.session, params)));

  server.tool("press", "Press a keyboard key", {
    session: z.string().describe("Session ID"),
    key: z.string().describe("Key to press (e.g. Enter, Tab, Escape)")
  }, async (params) => ok(await sessionManager.press(params.session, params)));

  server.tool("clear", "Clear text from an input field", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Accessible name of the field"),
    role: z.string().optional().describe("ARIA role (default: textbox)")
  }, async (params) => ok(await sessionManager.clear(params.session, params)));

  server.tool("upload", "Upload a file to a file input", {
    session: z.string().describe("Session ID"),
    name: z.string().describe("Label of the file input"),
    file: z.string().describe("Path to the file to upload")
  }, async (params) => ok(await sessionManager.upload(params.session, params)));

  server.tool("scroll", "Scroll the page", {
    session: z.string().describe("Session ID"),
    direction: z.enum(["up", "down", "top", "bottom"]).optional().describe("Scroll direction (default: down)"),
    amount: z.number().optional().describe("Scroll amount in pixels (default: 500)")
  }, async (params) => ok(await sessionManager.scroll(params.session, params)));

  server.tool("content", "Get page content", {
    session: z.string().describe("Session ID"),
    selector: z.string().optional().describe("CSS selector (default: full page)"),
    format: z.enum(["markdown", "html", "text"]).optional().describe("Output format (default: markdown)")
  }, async (params) => ok(await sessionManager.content(params.session, params)));

  server.tool("screenshot", "Take a screenshot", {
    session: z.string().describe("Session ID"),
    output: z.string().optional().describe("Output file path"),
    fullPage: z.boolean().optional().describe("Capture full page")
  }, async (params) => ok(await sessionManager.screenshot(params.session, params)));

  server.tool("save-pdf", "Save the current page as PDF", {
    session: z.string().describe("Session ID"),
    output: z.string().optional().describe("Output file path (default: page.pdf)"),
    format: z.string().optional().describe("Page format (Letter, A4, Legal, Tabloid)"),
    printBackground: z.boolean().optional().describe("Print background graphics")
  }, async (params) => ok(await sessionManager.savePdf(params.session, params)));

  server.tool("wait", "Wait for a selector to appear", {
    session: z.string().describe("Session ID"),
    selector: z.string().describe("CSS selector to wait for"),
    timeout: z.number().optional().describe("Timeout in ms (default: 5000)")
  }, async (params) => ok(await sessionManager.wait(params.session, params)));

  server.tool("eval", "Evaluate JavaScript in the page", {
    session: z.string().describe("Session ID"),
    script: z.string().describe("JavaScript code to evaluate")
  }, async (params) => ok(await sessionManager.evaluate(params.session, params.script)));

  server.tool("expect", "Assert expectations on page elements", {
    session: z.string().describe("Session ID"),
    selector: z.string().describe("CSS selector"),
    assertion: z.enum(["have_text", "be_visible", "exist", "not_exist", "have_attribute", "have_count", "have_count_at_least", "have_url", "have_title"]).describe("Assertion type"),
    expected: z.string().optional().describe("Expected value (for have_text, have_attribute, have_count, have_url, have_title)"),
    timeout: z.string().optional().describe("Timeout in ms (default: 5000)")
  }, async (params) => ok(await sessionManager.expect(params.session, params)));

  server.tool("expect-list", "Assert expectations on a list of items", {
    session: z.string().describe("Session ID"),
    assertion: z.enum(["at_least", "contains"]).describe("Assertion type"),
    expected: z.string().describe("Expected value (count for at_least, text for contains)"),
    selector: z.string().optional().describe("CSS selector for the list container"),
    timeout: z.string().optional().describe("Timeout in ms (default: 10000)")
  }, async (params) => ok(await sessionManager.expectList(params.session, params)));

  server.tool("get-items", "Get text content of all items in a list", {
    session: z.string().describe("Session ID"),
    selector: z.string().optional().describe("CSS selector for the list container")
  }, async (params) => ok(await sessionManager.getItems(params.session, params)));

  server.tool("cookies", "Manage cookies", {
    session: z.string().describe("Session ID"),
    export: z.string().optional().describe("Export cookies to file"),
    import: z.string().optional().describe("Import cookies from file")
  }, async (params) => ok(await sessionManager.cookies(params.session, params)));

  server.tool("download", "Download a file", {
    session: z.string().describe("Session ID"),
    url: z.string().describe("URL to download"),
    output: z.string().describe("Output file path")
  }, async (params) => ok(await sessionManager.download(params.session, params)));

  server.tool("set-scope", "Restrict subsequent commands to elements within a CSS selector", {
    session: z.string().describe("Session ID"),
    selector: z.string().describe("CSS selector to scope to")
  }, async (params) => ok(sessionManager.setScope(params.session, params.selector)));

  server.tool("clear-scope", "Clear the current scope restriction", {
    session: z.string().describe("Session ID")
  }, async (params) => ok(sessionManager.clearScope(params.session)));

  server.tool("new-tab", "Open a new tab", {
    session: z.string().describe("Session ID"),
    url: z.string().optional().describe("URL to open in new tab")
  }, async (params) => ok(await sessionManager.newTab(params.session, params.url)));

  server.tool("switch-tab", "Switch to a tab", {
    session: z.string().describe("Session ID"),
    tab: z.number().describe("Tab index")
  }, async (params) => ok(await sessionManager.switchTab(params.session, params.tab)));

  server.tool("close-tab", "Close a tab", {
    session: z.string().describe("Session ID"),
    tab: z.number().describe("Tab index")
  }, async (params) => ok(await sessionManager.closeTab(params.session, params.tab)));

  server.tool("list-tabs", "List tabs in a session", {
    session: z.string().describe("Session ID")
  }, async (params) => ok(sessionManager.listTabs(params.session)));

  server.tool("execute", "Execute a batch of instructions", {
    session: z.string().describe("Session ID"),
    instructions: z.array(z.object({
      method: z.string(),
      params: z.record(z.string()).optional()
    })).describe("Array of {method, params} instructions")
  }, async (params) => ok(await sessionManager.execute(params.session, params.instructions)));

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
