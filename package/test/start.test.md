# Start

## browser help

```execute
aux4 browser --help 2>/dev/null | head -2
```

```expect
browser
Headless browser automation.
```

## start and stop daemon

```timeout
30000
```

```execute
aux4 browser start --persistent true > /dev/null 2>&1 &
sleep 4
aux4 browser list 2>/dev/null
```

```expect
[]
```

```timeout
10000
```

```execute
aux4 browser stop > /dev/null 2>&1
sleep 1
echo "done"
```

```expect
done
```
