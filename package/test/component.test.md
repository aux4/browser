# component

## on a page with table, list, and form

```file:component-fixture.html
<!DOCTYPE html>
<html>
<head><title>Component Fixture</title></head>
<body>
  <h1>Fixture</h1>

  <table aria-label="Orders">
    <thead>
      <tr><th>Name</th><th>Status</th><th>Total</th></tr>
    </thead>
    <tbody>
      <tr><td>Acme</td><td>Paid</td><td>100</td></tr>
      <tr><td>Globex</td><td>Pending</td><td>200</td></tr>
      <tr><td>Initech</td><td>Paid</td><td>300</td></tr>
    </tbody>
  </table>

  <ul aria-label="Tasks">
    <li>Alpha</li>
    <li>Bravo</li>
    <li>Charlie</li>
  </ul>

  <form aria-label="Login">
    <label>Email <input type="email" name="email"></label>
    <label>Password <input type="password" name="password"></label>
    <button type="submit">Sign In</button>
  </form>
</body>
</html>
```

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
```

### should read a table cell by row and column index

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/component-fixture.html")
aux4 browser component --session $SESSION --type table --name Orders --row 2 --col 1 --action read | grep -o '"text":"[^"]*"'
aux4 browser close --session $SESSION >/dev/null
```

```expect
"text":"Acme"
```

### should read a table cell by column header name

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/component-fixture.html")
aux4 browser component --session $SESSION --type table --name Orders --row 3 --col Status --action read | grep -o '"text":"[^"]*"'
aux4 browser close --session $SESSION >/dev/null
```

```expect
"text":"Pending"
```

### should count list items

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/component-fixture.html")
aux4 browser component --session $SESSION --type list --name Tasks --action count | grep -o '"count":[0-9]*'
aux4 browser close --session $SESSION >/dev/null
```

```expect
"count":3
```

### should read a list item by index

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/component-fixture.html")
aux4 browser component --session $SESSION --type list --name Tasks --item 2 --action read | grep -o '"text":"[^"]*"'
aux4 browser close --session $SESSION >/dev/null
```

```expect
"text":"Bravo"
```

### should return bounds for a component

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/component-fixture.html")
aux4 browser component --session $SESSION --type table --name Orders --action bounds | grep -oE '"bounds":\{"x":[0-9.]+' | head -1
aux4 browser close --session $SESSION >/dev/null
```

```expect:regex
"bounds":\{"x":[0-9.]+
```

### should fail on unknown component type

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/component-fixture.html")
aux4 browser component --session $SESSION --type unicorn --action locate
EXIT=$?
aux4 browser close --session $SESSION >/dev/null
echo "exit:$EXIT"
```

```expect:partial
exit:1
```

```error:partial
Unknown component type
```
