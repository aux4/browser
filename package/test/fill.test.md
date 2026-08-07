# Fill

## fill a whole form in one call

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

```file:fill-fixture.html
<html>
<body>
  <form>
    <label for="fullName">Full name</label><input id="fullName" name="fullName" type="text">
    <label for="role">Role</label>
    <select id="role" name="role">
      <option value="">Choose a role</option>
      <option value="engineer">Engineer</option>
      <option value="designer">Designer</option>
    </select>
    <label for="news">Subscribe to the newsletter</label>
    <input id="news" name="news" type="checkbox" value="yes">
    <button type="submit">Save</button>
  </form>
</body>
</html>
```

### should fill a text field, a dropdown and a checkbox in one call

The point of `fill` is that the caller does not choose the verb: the page decides whether a field
is typed into, selected or ticked.

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field "Full name=Sally Reed" --field "Role=engineer" --field "Subscribe to the newsletter=yes" 2>/dev/null | node -pe "const r=JSON.parse(require('fs').readFileSync(0,'utf8')); r.status+' '+r.filled+' '+r.fields.map(f=>f.role).join(',')"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
ok 3 textbox,combobox,checkbox
```

### should select a dropdown option by its visible label

A caller may know the option as "Engineer" (what is on screen) rather than `engineer` (the value).

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field "Role=Engineer" >/dev/null 2>&1
aux4 browser eval --session $SESSION --script "document.getElementById('role').value" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
engineer
```

### should fill the fields it can and report the ones it cannot

A field that is not on the page must not stop the others: partial progress is reported per field
so the caller can take another route for the rest.

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field "Full name=Sally Reed" --field "Nonexistent Field=x" 2>/dev/null | node -pe "const r=JSON.parse(require('fs').readFileSync(0,'utf8')); r.status+' filled='+r.filled+' failed='+r.failed.join(',')"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
partial filled=1 failed=Nonexistent Field
```

### should say the page is wrong when nothing matches

`filled: 0` almost always means the session is not on the page the caller thinks it is, so the
result names the page and what is actually on it rather than suggesting a retry.

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field "Nope=1" --field "AlsoNope=2" 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).hint"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
*None of these fields are on this page*
```

### should always return the page state

Whatever happened, the caller needs to see the page it is now on — especially when a field failed.

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field "Full name=Sally Reed" 2>/dev/null | node -pe "const r=JSON.parse(require('fs').readFileSync(0,'utf8')); (r.snapshot?'snapshot':'none')+' '+(r.url?'url':'none')"
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
snapshot url
```
