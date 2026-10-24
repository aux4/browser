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

  <form aria-label="Contact">
    <label for="contact-name">Name</label>
    <input id="contact-name" name="name" type="text">
    <label for="contact-bio">Bio</label>
    <textarea id="contact-bio" name="bio"></textarea>
    <label for="contact-plan">Plan</label>
    <select id="contact-plan" name="plan">
      <option value="">Choose</option>
      <option value="pro">Pro</option>
      <option value="basic">Basic</option>
    </select>
    <label><input type="checkbox" id="contact-subscribe" name="subscribe"> Subscribe</label>
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

### should fill a text field using the bare "fill" action word

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/component-fixture.html")
aux4 browser component fill --session $SESSION --type form --name Contact --field Name --value "Ada Lovelace"
aux4 browser eval --session $SESSION --script "document.getElementById('contact-name').value"
aux4 browser close --session $SESSION >/dev/null
```

```expect:partial
Ada Lovelace
```

### should report the resulting url and title after filling a field

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/component-fixture.html")
aux4 browser component fill --session $SESSION --type form --name Contact --field Name --value "Ada Lovelace" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  console.log('status:' + d.status);
  console.log('hasUrl:' + !!d.url);
  console.log('hasTitle:' + (d.title !== undefined));
"
aux4 browser close --session $SESSION >/dev/null
```

```expect
status:ok
hasUrl:true
hasTitle:true
```

### should fill a textarea

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/component-fixture.html")
aux4 browser component --session $SESSION --type form --name Contact --field Bio --value "hello world" --action fill
aux4 browser eval --session $SESSION --script "document.getElementById('contact-bio').value"
aux4 browser close --session $SESSION >/dev/null
```

```expect:partial
hello world
```

### should fill a select by option label

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/component-fixture.html")
aux4 browser component --session $SESSION --type form --name Contact --field Plan --value Pro --action fill
aux4 browser eval --session $SESSION --script "document.getElementById('contact-plan').value"
aux4 browser close --session $SESSION >/dev/null
```

```expect:partial
pro
```

### should check a checkbox

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/component-fixture.html")
aux4 browser component --session $SESSION --type form --name Contact --field Subscribe --value true --action fill
aux4 browser eval --session $SESSION --script "document.getElementById('contact-subscribe').checked"
aux4 browser close --session $SESSION >/dev/null
```

```expect:partial
true
```

### should fill multiple fields with a fields JSON map

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/component-fixture.html")
aux4 browser component --session $SESSION --type form --name Contact --fields '{"Name":"Grace Hopper","Bio":"Admiral"}' --action fill | grep -o '"filled":[0-9]*'
aux4 browser eval --session $SESSION --script "document.getElementById('contact-name').value + '|' + document.getElementById('contact-bio').value"
aux4 browser close --session $SESSION >/dev/null
```

```expect
"filled":2
Grace Hopper|Admiral
```

### should fail with a clear error when the field cannot be matched

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/component-fixture.html")
aux4 browser component --session $SESSION --type form --name Contact --field "No Such Field" --value x --action fill
EXIT=$?
aux4 browser close --session $SESSION >/dev/null
echo "exit:$EXIT"
```

```expect:partial
exit:1
```

```error:partial
component fill: field \"No Such Field\" not found
```

### should point to the simpler `fill` --field form when no --value and no --fields is given

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/component-fixture.html")
aux4 browser component --session $SESSION --type form --name Contact --field Name --action fill
EXIT=$?
aux4 browser close --session $SESSION >/dev/null
echo "exit:$EXIT"
```

```expect:partial
exit:1
```

```error:partial
component fill: provide --fields (json) or --value*--field \"Name=value\"
```

### should point to `fill` when given a field-level type instead of a structural one

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/component-fixture.html")
aux4 browser component --session $SESSION --type input --action locate
EXIT=$?
aux4 browser close --session $SESSION >/dev/null
echo "exit:$EXIT"
```

```expect:partial
exit:1
```

```error:partial
aux4 browser fill --session *?
```
