# Hub Search

## Search for playbook on hub.aux4.io

```timeout
60000
```

```file:search-playbook.txt
go to "https://hub.aux4.io"
type "playbook" in "Search packages..."
press "Enter"
expect list to contain "playbook"
click on list item "playbook"
expect "h2" to have text "Installation" within 10 seconds
get content as "text"
```

```execute
aux4 browser run --instructions search-playbook.txt 2>/dev/null
```

```expect:partial
Hello World!
```
