# not-found errors list what IS on the page (BRW-010)

A field/element "not found" error used to say only the wrong name back, so an agent that guessed wrong kept
guessing. It now also lists the labels/buttons actually on the page (or says there are none), plus the
current url/title, capped at 15 of each.

```file:not-found-fixture.html
<!DOCTYPE html>
<html>
<head><title>Not Found Fixture</title></head>
<body>
  <form aria-label="Review">
    <label for="notes">Notes</label>
    <input id="notes" name="notes" type="text">
    <button type="submit">Confirm</button>
    <button type="button">Back</button>
  </form>
</body>
</html>
```

```file:no-fields-fixture.html
<!DOCTYPE html>
<html>
<head><title>No Fields Fixture</title></head>
<body>
  <p>Nothing to fill here.</p>
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

## fill: field not on the page

### should list the actual fields and buttons plus url/title

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/not-found-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field Destination --value tokyo
EXIT=$?
aux4 browser close --session $SESSION >/dev/null 2>&1
echo "exit:$EXIT"
```

```error:partial
field \"Destination\" not found
```

```error:partial
title: \"Not Found Fixture\"
```

```error:partial
Fields on this page: \"Notes\" (text)
```

```error:partial
Buttons/links: \"Confirm\", \"Back\"
```

```expect:partial
exit:1
```

## fill: page has no form fields at all

### should say so instead of listing nothing

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/no-fields-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field Anything --value x
EXIT=$?
aux4 browser close --session $SESSION >/dev/null 2>&1
echo "exit:$EXIT"
```

```error:partial
This page has no form fields.
```

```expect:partial
exit:1
```

## component fill: field not on the page

### should also list the actual fields and buttons

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/not-found-fixture.html" 2>/dev/null)
aux4 browser component --session $SESSION --type form --name Review --action fill --field Destination --value tokyo
EXIT=$?
aux4 browser close --session $SESSION >/dev/null 2>&1
echo "exit:$EXIT"
```

```error:partial
component fill: field \"Destination\" not found
```

```error:partial
Fields on this page: \"Notes\" (text)
```

```expect:partial
exit:1
```

## type: role/name match fails

### should list the actual fields and buttons

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/not-found-fixture.html" 2>/dev/null)
aux4 browser type --session $SESSION --name Destination --value tokyo --timeout 500
EXIT=$?
aux4 browser close --session $SESSION >/dev/null 2>&1
echo "exit:$EXIT"
```

```error:partial
Fields on this page: \"Notes\" (text)
```

```expect:partial
exit:1
```
