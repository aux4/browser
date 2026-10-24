# fill

## filling a field by label on a plain page

```file:fill-fixture.html
<!DOCTYPE html>
<html>
<head><title>Fill Fixture</title></head>
<body>
  <form aria-label="Contact">
    <label for="name">Name</label>
    <input id="name" name="name" type="text">
    <label for="bio">Bio</label>
    <textarea id="bio" name="bio"></textarea>
    <label for="plan">Plan</label>
    <select id="plan" name="plan">
      <option value="">Choose</option>
      <option value="pro">Pro</option>
      <option value="basic">Basic</option>
    </select>
    <label><input type="checkbox" id="subscribe" name="subscribe"> Subscribe</label>
    <button type="submit">Save</button>
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
sleep 1
```

### should fill a text field by its label

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field Name --value Ann 2>/dev/null
aux4 browser eval --session $SESSION --script "document.getElementById('name').value" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
"status":"ok"
```

```expect:partial
Ann
```

### should fill a textarea by its label

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field Bio --value "built with aux4" >/dev/null 2>&1
aux4 browser eval --session $SESSION --script "document.getElementById('bio').value" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
built with aux4
```

### should select an option by label

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field Plan --value Pro >/dev/null 2>&1
aux4 browser eval --session $SESSION --script "document.getElementById('plan').value" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
pro
```

### should check a checkbox when value is truthy

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field Subscribe --value true >/dev/null 2>&1
aux4 browser eval --session $SESSION --script "document.getElementById('subscribe').checked" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
true
```

### should fill multiple fields with a fields JSON map

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --fields '{"Name":"Ann","Bio":"hello"}' 2>/dev/null
aux4 browser eval --session $SESSION --script "document.getElementById('name').value + '/' + document.getElementById('bio').value" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
"filled":2
```

```expect:partial
Ann/hello
```

### should report url/title after filling (no bare status:ok)

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field Name --value Ann 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
"title":"Fill Fixture"
```

### should name the form's submit button after a successful fill

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field Name --value Ann 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
"submit":{"button":"Save"}
```

### should fail with a clear error when the field cannot be matched

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field Nonexistent --value x
EXIT=$?
aux4 browser close --session $SESSION >/dev/null 2>&1
echo "exit:$EXIT"
```

```error:partial
field \"Nonexistent\" not found
```

```expect:partial
exit:1
```

### should fail with a clear error (the canonical --field form) when neither field nor fields is given

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION
EXIT=$?
aux4 browser close --session $SESSION >/dev/null 2>&1
echo "exit:$EXIT"
```

```error:partial
use --field \"Destination=Tokyo\" (repeat --field for more fields, e.g. --field \"Class=Business\")
```

```expect:partial
exit:1
```

### builds the error's example from --value when a small model drops --label/other unknown flags (--value survives, --label does not)

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --label Name --value Tokyo
EXIT=$?
aux4 browser close --session $SESSION >/dev/null 2>&1
echo "exit:$EXIT"
```

```error:partial
use --field \"Label=Tokyo\" (repeat --field for more fields, e.g. --field \"Class=Business\")
```

```expect:partial
exit:1
```
