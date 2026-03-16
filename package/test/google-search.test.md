# Hub Search

## Search for playbook on hub.aux4.io

```timeout
90000
```

```file:search-playbook.txt
go to "https://hub.aux4.io"
sleep 2 seconds
type "playbook" in "Search packages..."
press "Enter"
sleep 3 seconds
expect list to contain "playbook"
click on list item "playbook"
expect "h2" to have text "Installation" within 15 seconds
get content as "text"
```

```execute
aux4 browser run --instructions search-playbook.txt
```

```expect:partial
Hello World!
```
