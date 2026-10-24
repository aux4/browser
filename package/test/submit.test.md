# submit

## submitting the only form on the page

```file:submit-fixture.html
<!DOCTYPE html>
<html>
<head><title>Contact Form</title></head>
<body>
  <form aria-label="Contact" onsubmit="event.preventDefault(); document.getElementById('result').textContent='sent'">
    <label for="name">Name</label>
    <input id="name" name="name" type="text">
    <label for="email">Email</label>
    <input id="email" name="email" type="email">
    <button type="submit">Send</button>
  </form>
  <div id="result"></div>
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

### should click the form's submit button after a fill

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/submit-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --fields '{"Name":"Ann","Email":"ann@example.com"}' >/dev/null 2>&1
aux4 browser submit --session $SESSION 2>/dev/null
aux4 browser eval --session $SESSION --script "document.getElementById('result').textContent" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
"status":"ok"
```

```expect:partial
"button":"Send"
```

```expect:partial
sent
```

### should submit even with no prior fill, falling back to form.requestSubmit when there is no button

```timeout
30000
```

```file:submit-no-button-fixture.html
<!DOCTYPE html>
<html>
<head><title>No Button Form</title></head>
<body>
  <form aria-label="Search" onsubmit="event.preventDefault(); document.getElementById('result').textContent='searched'">
    <label for="q">Query</label>
    <input id="q" name="q" type="text">
  </form>
  <div id="result"></div>
</body>
</html>
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/submit-no-button-fixture.html" 2>/dev/null)
aux4 browser submit --session $SESSION 2>/dev/null
aux4 browser eval --session $SESSION --script "document.getElementById('result').textContent" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
"status":"ok"
```

```expect:partial
searched
```

## submitting a named form with --within

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

### should submit the form named by --within when there are multiple forms

```timeout
30000
```

```file:submit-multi-form-fixture.html
<!DOCTYPE html>
<html>
<head><title>Two Forms</title></head>
<body>
  <form aria-label="Newsletter" onsubmit="event.preventDefault(); document.getElementById('a').textContent='signed up'">
    <label for="news-email">Email</label>
    <input id="news-email" name="email" type="email">
    <button type="submit">Subscribe</button>
  </form>
  <form aria-label="Contact" onsubmit="event.preventDefault(); document.getElementById('b').textContent='sent'">
    <label for="contact-name">Name</label>
    <input id="contact-name" name="name" type="text">
    <button type="submit">Send</button>
  </form>
  <div id="a"></div>
  <div id="b"></div>
</body>
</html>
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/submit-multi-form-fixture.html" 2>/dev/null)
aux4 browser fill --session $SESSION --field Name --value Ann >/dev/null 2>&1
aux4 browser submit --session $SESSION --within "Contact" 2>/dev/null
aux4 browser eval --session $SESSION --script "document.getElementById('a').textContent + '/' + document.getElementById('b').textContent" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect:partial
"button":"Send"
```

```expect:partial
/sent
```

## no form on the page

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

### should fail with a clear error listing the page's buttons when there is no form

```timeout
30000
```

```file:submit-no-form-fixture.html
<!DOCTYPE html>
<html>
<head><title>No Form</title></head>
<body>
  <button onclick="void(0)">Learn more</button>
  <p>No forms on this page.</p>
</body>
</html>
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/submit-no-form-fixture.html" 2>/dev/null)
aux4 browser submit --session $SESSION
EXIT=$?
aux4 browser close --session $SESSION >/dev/null 2>&1
echo "exit:$EXIT"
```

```error:partial
submit: no form found on this page.*?
```

```error:partial
Learn more
```

```expect:partial
exit:1
```
