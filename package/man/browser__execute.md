# browser execute

Execute a batch of instructions sequentially. Stops on first error.

## Usage

```
aux4 browser execute --session <id> --instructions <file>
```

## Options

- `--session` — Session ID (required)
- `--instructions` — Path to instructions file (required)

## Instructions Format

Playbook text file with one instruction per line:

```text
go to "https://example.com"
click "Submit"
screenshot "result.png"
```

JSON array format is also supported:

```json
[
  {
    "method": "visit",
    "params": {
      "url": "https://example.com"
    }
  },
  {
    "method": "click",
    "params": {
      "name": "Submit"
    }
  },
  {
    "method": "screenshot",
    "params": {
      "output": "result.png"
    }
  }
]
```
