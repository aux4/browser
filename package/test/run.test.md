# Run

## run playbook script

```timeout
30000
```

```file:goto.txt
go to "https://aux4.io"
get content as "text"
```

```execute
aux4 browser run --instructions goto.txt 2>/dev/null | grep -o "aux4" | head -1
```

```expect
aux4
```

## run with initial url

```timeout
30000
```

```file:content-only.txt
get content as "text"
```

```execute
aux4 browser run --url https://aux4.io --instructions content-only.txt 2>/dev/null | grep -o "aux4" | head -1
```

```expect
aux4
```

## run with failed instruction

```timeout
30000
```

```file:fail-test.txt
go to "https://aux4.io"
expect ".nonexistent" to exist
get content as "text"
```

```execute
aux4 browser run --instructions fail-test.txt 2>/dev/null; echo "exit:$?"
```

```expect
exit:1
```
