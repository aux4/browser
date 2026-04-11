import { StartCommand } from "../commands/StartCommand.js";
import { StopCommand } from "../commands/StopCommand.js";
import { OpenCommand } from "../commands/OpenCommand.js";
import { CloseCommand } from "../commands/CloseCommand.js";
import { ListCommand } from "../commands/ListCommand.js";
import { VisitCommand } from "../commands/GotoCommand.js";
import { BackCommand } from "../commands/BackCommand.js";
import { ForwardCommand } from "../commands/ForwardCommand.js";
import { ReloadCommand } from "../commands/ReloadCommand.js";
import { ClickCommand } from "../commands/ClickCommand.js";
import { ClickSelectorCommand } from "../commands/ClickSelectorCommand.js";
import { ClickTextCommand } from "../commands/ClickTextCommand.js";
import { ClickItemCommand } from "../commands/ClickItemCommand.js";
import { ExpectListCommand } from "../commands/ExpectListCommand.js";
import { GetItemsCommand } from "../commands/GetItemsCommand.js";
import { TypeCommand } from "../commands/TypeCommand.js";
import { ScrollCommand } from "../commands/ScrollCommand.js";
import { ContentCommand } from "../commands/ContentCommand.js";
import { ScreenshotCommand } from "../commands/ScreenshotCommand.js";
import { WaitCommand } from "../commands/WaitCommand.js";
import { EvalCommand } from "../commands/EvalCommand.js";
import { ExpectCommand } from "../commands/ExpectCommand.js";
import { CookiesCommand } from "../commands/CookiesCommand.js";
import { DownloadCommand } from "../commands/DownloadCommand.js";
import { SavePdfCommand } from "../commands/SavePdfCommand.js";
import { NewTabCommand, SwitchTabCommand, CloseTabCommand, ListTabsCommand } from "../commands/TabsCommand.js";
import { SelectCommand } from "../commands/SelectCommand.js";
import { CheckCommand, UncheckCommand } from "../commands/CheckCommand.js";
import { HoverCommand } from "../commands/HoverCommand.js";
import { PressCommand } from "../commands/PressCommand.js";
import { ClearCommand } from "../commands/ClearCommand.js";
import { UploadCommand } from "../commands/UploadCommand.js";
import { SetScopeCommand, ClearScopeCommand } from "../commands/ScopeCommand.js";
import { ComponentCommand } from "../commands/ComponentCommand.js";
import { SnapshotCommand } from "../commands/SnapshotCommand.js";
import { McpCommand } from "../commands/McpCommand.js";

const args = process.argv.slice(2);
const action = args[0];
const values = args.slice(1);

const commands = {
  start:       { handler: StartCommand,    args: ["maxSessions", "persistent", "channel", "browser"] },
  stop:        { handler: StopCommand,     args: [] },
  open:        { handler: OpenCommand,     args: ["url", "timeout", "width", "height", "output", "video", "snapshot"] },
  close:       { handler: CloseCommand,    args: ["session"] },
  list:        { handler: ListCommand,     args: [] },
  visit:       { handler: VisitCommand,    args: ["session", "url"] },
  back:        { handler: BackCommand,     args: ["session"] },
  forward:     { handler: ForwardCommand,  args: ["session"] },
  reload:      { handler: ReloadCommand,   args: ["session"] },
  click:       { handler: ClickCommand,    args: ["session", "name", "role"] },
  "click-selector": { handler: ClickSelectorCommand, args: ["session", "selector"] },
  "click-text": { handler: ClickTextCommand, args: ["session", "text"] },
  "click-item": { handler: ClickItemCommand, args: ["session", "item", "selector"] },
  type:        { handler: TypeCommand,     args: ["session", "name", "value", "role"] },
  scroll:      { handler: ScrollCommand,   args: ["session", "direction", "amount"] },
  content:     { handler: ContentCommand,  args: ["session", "selector", "format"] },
  screenshot:  { handler: ScreenshotCommand, args: ["session", "output", "fullPage"] },
  wait:        { handler: WaitCommand,     args: ["session", "selector", "timeout"] },
  eval:        { handler: EvalCommand,     args: ["session", "script"] },
  expect:      { handler: ExpectCommand,  args: ["session", "selector", "assertion", "expected", "timeout"] },
  "expect-list": { handler: ExpectListCommand, args: ["session", "assertion", "expected", "selector", "timeout"] },
  "get-items": { handler: GetItemsCommand, args: ["session", "selector"] },
  cookies:     { handler: CookiesCommand,  args: ["session", "export", "import"] },
  download:    { handler: DownloadCommand, args: ["session", "url", "output"] },
  "save-pdf":  { handler: SavePdfCommand,  args: ["session", "output", "format", "printBackground"] },
  select:      { handler: SelectCommand,   args: ["session", "name", "value", "role"] },
  check:       { handler: CheckCommand,    args: ["session", "name", "role"] },
  uncheck:     { handler: UncheckCommand,  args: ["session", "name", "role"] },
  hover:       { handler: HoverCommand,    args: ["session", "name", "role"] },
  press:       { handler: PressCommand,    args: ["session", "key"] },
  clear:       { handler: ClearCommand,    args: ["session", "name", "role"] },
  upload:      { handler: UploadCommand,   args: ["session", "name", "file"] },
  "set-scope": { handler: SetScopeCommand, args: ["session", "selector"] },
  "clear-scope": { handler: ClearScopeCommand, args: ["session"] },
  component:   { handler: ComponentCommand, args: ["session", "type", "action", "name", "row", "col", "where", "item", "field", "fields", "value", "tab", "path", "title", "timeout"] },
  snapshot:    { handler: SnapshotCommand, args: ["session", "mode", "format"] },
  "new-tab":   { handler: NewTabCommand,   args: ["session", "url"] },
  "switch-tab": { handler: SwitchTabCommand, args: ["session", "tab"] },
  "close-tab": { handler: CloseTabCommand, args: ["session", "tab"] },
  "list-tabs": { handler: ListTabsCommand, args: ["session"] },
  mcp:         { handler: McpCommand,      args: [] }
};

const command = commands[action];
if (!command) {
  console.error(`Unknown action: ${action}`);
  process.exit(1);
}

const params = {};
command.args.forEach((name, i) => {
  if (values[i] !== undefined && values[i] !== "") {
    try {
      const parsed = JSON.parse(values[i]);
      if (Array.isArray(parsed)) {
        params[name] = parsed;
      } else {
        params[name] = values[i];
      }
    } catch {
      params[name] = values[i];
    }
  }
});

try {
  await command.handler(params);
} catch (e) {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
}
