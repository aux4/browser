# browser actions

`actions` lists every control a person could use on the page — fields, buttons, links, options and clickable
elements with no role — with its label, value, context, snapshot `ref` (when it has one) and a `selector` that
addresses it exactly, including inside open shadow roots and iframes.

```beforeAll
aux4 browser stop
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 3
```

```afterAll
aux4 browser stop
```

```file:actions-child.html
<html>
<body>
  <button type="button" onclick="this.textContent='Frame done'">Frame button</button>
</body>
</html>
```

```file:actions.html
<html>
<head><title>Find Care</title>
<style>
  .sugg { cursor: pointer; }
  .panel { display: none; }
  .panel.open { display: block; }
</style>
</head>
<body>
  <header><nav><a href="#home">Home</a></nav></header>
  <main>
    <h1>Find a doctor</h1>
    <section>
      <h2>Where</h2>
      <button type="button" id="loc" onclick="document.getElementById('panel').classList.add('open')">Location</button>
      <div class="panel" id="panel">
        <label for="where">City or ZIP code</label>
        <input id="where" type="text" value="90292" />
        <div class="sugg">Venice, CA 90292</div>
        <button type="button">Apply</button>
      </div>
      <button type="button" disabled>Disabled</button>
    </section>
    <div id="host"></div>
    <iframe id="f" src="actions-child.html" width="400" height="120"></iframe>
  </main>
  <script>
    document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = '<button type="button">Shadow button</button>';
  </script>
</body>
</html>
```

## listing controls

### should list visible, enabled controls with role, label and context, skipping page chrome by default

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/actions.html" 2>/dev/null)
aux4 browser click-selector --session $SESSION --selector "#loc" > /dev/null
aux4 browser actions --session $SESSION | node -e "
  const o = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  for (const a of o.actions) console.log(a.role, '|', a.label, '|', a.value || '', '|', a.context.headingPath.join(' > '), '|', a.within || '');
"
aux4 browser close --session $SESSION > /dev/null
```

```expect
button | Location |  | Find a doctor > Where | 
textbox | City or ZIP code | 90292 | Find a doctor > Where | 
card | Venice, CA 90292 |  | Find a doctor > Where | 
button | Apply |  | Find a doctor > Where | 
button | Shadow button |  | Find a doctor > Where | 
button | Frame button |  |  | iframe#f
```

### should include page chrome with --includeNav true

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/actions.html" 2>/dev/null)
aux4 browser actions --session $SESSION --includeNav true | node -e "
  const o = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  console.log(o.actions[0].role, o.actions[0].label, o.actions[0].context.region);
"
aux4 browser close --session $SESSION > /dev/null
```

```expect
link Home nav
```

## acting on a listed control

### should give refs consistent with snapshot and selectors that work with click/type

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/actions.html" 2>/dev/null)
aux4 browser click-selector --session $SESSION --selector "#loc" > /dev/null
ACTIONS=$(aux4 browser actions --session $SESSION)
REF=$(echo "$ACTIONS" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).actions.find(a => a.label === 'City or ZIP code').ref")
aux4 browser snapshot --session $SESSION | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).snapshot.elements.find(e => e.ref === $REF).name"
aux4 browser type --session $SESSION --ref $REF --value 60601 | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
SEL=$(echo "$ACTIONS" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).actions.find(a => a.label === 'Frame button').selector")
aux4 browser click-selector --session $SESSION --selector "$SEL" --within "iframe#f" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
aux4 browser actions --session $SESSION | node -e "
  const o = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  console.log(o.actions.find(a => a.label === 'City or ZIP code').value);
  console.log(o.actions.some(a => a.label === 'Frame done'));
"
aux4 browser close --session $SESSION > /dev/null
```

```expect
City or ZIP code
ok
ok
60601
true
```

### should add headings, errors and text with --page true

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/actions.html" 2>/dev/null)
aux4 browser actions --session $SESSION --page true | node -e "
  const o = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  console.log(o.page.headings.join(' | '));
  console.log(o.page.errors.length, o.page.text.startsWith('Find a doctor'), o.page.textLength > 0);
"
aux4 browser close --session $SESSION > /dev/null
```

```expect
Find a doctor | Where
0 true true
```
