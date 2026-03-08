import { DaemonClient } from "../client/DaemonClient.js";

export async function NewTabCommand(params) {
  const client = new DaemonClient();
  await client.send("new-tab", {
    session: params.session,
    url: params.url
  });
}

export async function SwitchTabCommand(params) {
  const client = new DaemonClient();
  await client.send("switch-tab", {
    session: params.session,
    tab: params.tab
  });
}

export async function CloseTabCommand(params) {
  const client = new DaemonClient();
  await client.send("close-tab", {
    session: params.session,
    tab: params.tab
  });
}

export async function ListTabsCommand(params) {
  const client = new DaemonClient();
  const result = await client.send("list-tabs", {
    session: params.session
  });
  console.log(JSON.stringify(result));
}
