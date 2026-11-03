# browser connect

#### Description

Start the local aux4 daemon that waits for the aux4 Browser Connector to pair
with the Chrome profile already open on the user's computer. The command prints
a one-time pairing token and the steps needed to connect the extension.

The daemon listens only on `127.0.0.1` and uses a local WebSocket connection.
The extension stores the token locally and reconnects after temporary daemon or
transport failures. Pairing errors require a new token or a compatible
extension version.

Use `connect` instead of `start` when aux4 must operate the user's existing
browser windows, tabs, cookies, and signed-in pages. The Browser Connector
supports the normal browser command surface, except arbitrary `eval`,
full-page screenshots, and full-page PDF output.

#### Usage

```bash
aux4 browser connect [--port <port>]
```

`--port` is the local WebSocket port used by the extension. It defaults to
`8765`, which is also the extension's default, so the popup hides the port
field. If another local service uses that port, pass a different value and tick
**Use a custom port** in the extension popup to enter the same value.

#### Example

```bash
aux4 browser connect
```

```text
{
  "status": "waiting-for-extension",
  "wsUrl": "ws://127.0.0.1:8765",
  "token": "<pairing-token>",
  "next": [
    "Load the unpacked extension at chrome://extensions",
    "Click the aux4 Browser Connector icon",
    "Paste the token and Connect",
    "Run an aux4 browser command"
  ]
}
```
