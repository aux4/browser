# Open

## daemon not running error

```execute
aux4 browser stop > /dev/null 2>&1; sleep 1; aux4 browser list 2>/dev/null; echo "exit:$?"
```

```expect
exit:1
```

## open and close session

```timeout
30000
```

```execute
aux4 browser start --persistent true > /dev/null 2>&1 &
sleep 4
SESSION=$(aux4 browser open 2>/dev/null)
aux4 browser close --session $SESSION 2>/dev/null
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
