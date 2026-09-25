# blocks

## on a page with article cards, nested headings, a script blob, and nav/footer

```file:blocks-fixture.html
<!DOCTYPE html>
<html>
<head>
  <title>Blocks Fixture</title>
  <script id="__NEXT_DATA__" type="application/json">{"secretBlobMarker": "should-never-appear-in-blocks-output"}</script>
</head>
<body>
  <nav><a href="/home">Home</a><a href="/about">About</a></nav>
  <header><h1>Site Header</h1></header>
  <main>
    <h1>Latest Articles</h1>
    <section>
      <h2>Technology</h2>
      <article>
        <a href="/article/1">
          <img src="/img1.png" alt="">
          <span>Breaking News One</span>
        </a>
      </article>
      <article>
        <a href="/article/2">
          <img src="/img2.png" alt="">
          <span>Breaking News Two</span>
        </a>
      </article>
    </section>
    <p>Welcome to our site, the best source of tech news on the web today.</p>
    <ul>
      <li>First item</li>
      <li>Second item</li>
    </ul>
  </main>
  <footer><a href="/privacy">Privacy Policy</a></footer>
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

### should skip script/JSON blobs entirely

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/blocks-fixture.html")
aux4 browser blocks --session $SESSION | grep -c "secretBlobMarker"
aux4 browser close --session $SESSION >/dev/null
```

```expect
0
```

### should skip nav and footer by default

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/blocks-fixture.html")
aux4 browser blocks --session $SESSION | grep -c "Privacy Policy"
aux4 browser close --session $SESSION >/dev/null
```

```expect
0
```

### should include nav and footer when includeNav is true

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/blocks-fixture.html")
aux4 browser blocks --session $SESSION --includeNav true | grep -o '"text":"Privacy Policy"'
aux4 browser close --session $SESSION >/dev/null
```

```expect
"text":"Privacy Policy"
```

### should carry the href of an image-wrapped link on an article card

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/blocks-fixture.html")
aux4 browser blocks --session $SESSION | grep -o '"text":"Breaking News One"[^}]*"url":"[^"]*article/1"'
aux4 browser close --session $SESSION >/dev/null
```

```expect:partial
"text":"Breaking News One"*article/1"
```

### should compute headingPath for a heading nested two levels deep

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/blocks-fixture.html")
aux4 browser blocks --session $SESSION | grep -o '"text":"Technology"[^}]*"headingPath":\["Latest Articles","Technology"\]'
aux4 browser close --session $SESSION >/dev/null
```

```expect:partial
"text":"Technology"*"headingPath":["Latest Articles","Technology"]
```

### should emit each list item as its own block, scoped under the nearest preceding heading

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/blocks-fixture.html")
aux4 browser blocks --session $SESSION | grep -o '"text":"First item","heading":"Technology","headingPath":\["Latest Articles","Technology"\],"url":null,"selector":"[^"]*","offset":[0-9]*,"ref":6,"tag":"li"'
aux4 browser close --session $SESSION >/dev/null
```

```expect:partial
"text":"First item"*"tag":"li"
```

### should cap block text at maxBlockChars and flag it truncated

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/blocks-fixture.html")
aux4 browser blocks --session $SESSION --maxBlockChars 10 | grep -o '"text":"Welcome to[^"]*","heading":"Technology","headingPath":\["Latest Articles","Technology"\],"url":null,"selector":"[^"]*","offset":[0-9]*,"ref":null,"tag":"p","truncated":true'
aux4 browser close --session $SESSION >/dev/null
```

```expect:partial
"text":"Welcome to*"truncated":true
```

## on a page with no body content

```file:blocks-empty-fixture.html
<!DOCTYPE html>
<html>
<head><title>Empty Fixture</title></head>
<body></body>
</html>
```

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
```

### should return an empty array

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/blocks-empty-fixture.html")
aux4 browser blocks --session $SESSION
aux4 browser close --session $SESSION >/dev/null
```

```expect
[]
```
