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

## open refuses a second session on the same host

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

### should refuse a second open on a host that is already open

```timeout
60000
```

```execute
S1=$(aux4 browser open --url https://example.com --timeout 2m 2>/dev/null)
RESULT=$(aux4 browser open --url https://example.com --timeout 2m 2>/dev/null)
echo "$RESULT" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('status:' + d.status);
  console.log('reason:' + d.reason);
  console.log('sameSession:' + (d.session === '$S1'));
"
aux4 browser close --session $S1 >/dev/null 2>&1
```

```expect
status:error
reason:session-already-open
sameSession:true
```

### should allow --new to bypass the refusal and open a second independent session

```timeout
60000
```

```execute
S1=$(aux4 browser open --url https://example.com --timeout 2m 2>/dev/null)
S2=$(aux4 browser open --url https://example.com --timeout 2m --new true 2>/dev/null)
echo "s1Present:$([ -n "$S1" ] && echo true || echo false)"
echo "s2Present:$([ -n "$S2" ] && echo true || echo false)"
echo "distinct:$([ "$S1" != "$S2" ] && echo true || echo false)"
aux4 browser close --session $S1 >/dev/null 2>&1
aux4 browser close --session $S2 >/dev/null 2>&1
```

```expect
s1Present:true
s2Present:true
distinct:true
```
