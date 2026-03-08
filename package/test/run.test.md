# Run

## run playbook script

```timeout
30000
```

```file:goto.txt
go to "https://example.com"
get content as "text"
```

```execute
aux4 browser run --instructions goto.txt 2>/dev/null | cut -c1-14
```

```expect
Example Domain
```

## run with initial url

```timeout
30000
```

```file:content-only.txt
get content as "text"
```

```execute
aux4 browser run --url https://example.com --instructions content-only.txt 2>/dev/null | cut -c1-14
```

```expect
Example Domain
```

## run with failed instruction

```timeout
30000
```

```file:fail-test.txt
go to "https://example.com"
expect ".nonexistent" to exist
get content as "text"
```

```execute
aux4 browser run --instructions fail-test.txt 2>/dev/null; echo "exit:$?"
```

```expect
exit:1
```
