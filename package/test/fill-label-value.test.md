# fill with repeatable --field "Label=value" (BRW-010)

A dojo trace hit `aux4 browser fill --field "A=1" --field "B=2" ...` (repeated `--field` flags, each self
describing "Label=value", the natural guess for an agent that already knows curl-style repeatable flags) and
got `{"error":"fill: --value is required for field \"...\""}` because `--field` wasn't a repeatable/multi
variable: aux4 kept only the LAST `--field` and no `--value` was ever given. `fill` (and `component fill`) now
treat multiple `--field "Label=value"` flags — or a single one with no separate `--value` — as shorthand for
`--fields '{"Label":"value",...}'`, while the original `--field <label> --value <value>` form is untouched.

```file:fill-label-value-fixture.html
<!DOCTYPE html>
<html>
<head><title>Contact</title></head>
<body>
  <form aria-label="Contact">
    <label for="name">Full name</label>
    <input id="name" name="name" type="text">
    <label for="email">Email</label>
    <input id="email" name="email" type="email">
    <label for="dob">Date of birth (format YYYY-MM-DD)</label>
    <input id="dob" name="dob" type="text">
    <label for="message">Message</label>
    <textarea id="message" name="message"></textarea>
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

## the exact dojo repro: four repeated --field "Label=value" flags

### should fill all four fields, including one with parentheses and trailing punctuation in the label

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-label-value-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field "Full name=Priya Shah" --field "Email=priya@example.com" --field "Date of birth (format YYYY-MM-DD)=1990-03-14" --field "Message=Please add me to the mailing list." | grep -o '"filled":[0-9]*'
aux4 browser eval --session $SESSION --script "document.getElementById('name').value + '|' + document.getElementById('email').value + '|' + document.getElementById('dob').value + '|' + document.getElementById('message').value" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
"filled":4
Priya Shah|priya@example.com|1990-03-14|Please add me to the mailing list.
```

## a single --field "Label=value" with no separate --value

### should still work as a one-field shorthand

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-label-value-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field "Email=bob@example.com"
aux4 browser eval --session $SESSION --script "document.getElementById('email').value" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
bob@example.com
```

## the legacy --field <label> --value <value> form

### should still work exactly as before

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-label-value-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field "Full name" --value "Ann"
aux4 browser eval --session $SESSION --script "document.getElementById('name').value" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
Ann
```

## a repeated --field missing the "=" separator

### should error naming the expected "Label=value" form

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-label-value-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field "Full name=Bob" --field "NoEquals"
EXIT=$?
aux4 browser close --session $SESSION >/dev/null 2>&1
echo "exit:$EXIT"
```

```error:partial
fill: expected --field \"Label=value\", got \"NoEquals\"
```

```expect:partial
exit:1
```

## component fill with repeated --field "Label=value"

### should fill several fields within the named form in one call

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/fill-label-value-fixture.html" 2>/dev/null)
aux4 browser component --session $SESSION --type form --name Contact --action fill --field "Message=Hi there" --field "Full name=Carol" | grep -o '"filled":[0-9]*'
aux4 browser eval --session $SESSION --script "document.getElementById('message').value + '|' + document.getElementById('name').value" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
"filled":2
Hi there|Carol
```
