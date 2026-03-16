# Content

## get page content as text via run

```timeout
30000
```

```file:text-content.txt
go to "https://aux4.io"
get content as "text"
```

```execute
aux4 browser run --instructions text-content.txt 2>/dev/null | grep -o "aux4" | head -1
```

```expect
aux4
```

## get page content as markdown via run

```timeout
30000
```

```file:md-content.txt
go to "https://aux4.io"
get content as "markdown"
```

```execute
aux4 browser run --instructions md-content.txt 2>/dev/null | grep -o "aux4" | head -1
```

```expect
aux4
```

## get content via daemon

```timeout
30000
```

```execute
aux4 browser start --persistent true > /dev/null 2>&1 &
sleep 4
SESSION=$(aux4 browser open --url https://aux4.io 2>/dev/null)
sleep 1
aux4 browser content --session $SESSION --format text 2>/dev/null | grep -o "aux4" | head -1
```

```expect
aux4
```

```timeout
10000
```

```execute
aux4 browser close --session $SESSION > /dev/null 2>&1
aux4 browser stop > /dev/null 2>&1
sleep 1
echo "done"
```

```expect
done
```
