# Open

## list auto-starts daemon when not running

```timeout
30000
```

```execute
aux4 browser stop > /dev/null 2>&1
sleep 1
aux4 browser list 2>/dev/null
EXIT=$?
aux4 browser stop > /dev/null 2>&1
echo "exit:$EXIT"
```

```expect
[]
exit:0
```

## open and close session

```timeout
30000
```

```execute
aux4 browser start --persistent true > /dev/null 2>&1 &
sleep 4
SESSION=$(aux4 browser open 2>/dev/null)
aux4 browser close --session $SESSION > /dev/null 2>&1
echo "closed"
```

```expect
closed
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
