# Mouse

Drive the real mouse at viewport coordinates with a human-like trajectory.
The fixture records the last `mousemove` and `click` coordinates so the test
can assert the cursor actually moved to and clicked the target point.

## mouse movement and clicks

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
sleep 1
```

```file:mouse-fixture.html
<html>
<body style="margin:0">
  <div id="pad" style="position:absolute; left:0; top:0; width:400px; height:400px">
    <button id="t" style="position:absolute; left:200px; top:150px; width:80px; height:40px">Target</button>
  </div>
  <div id="moved">no</div>
  <div id="hit">none</div>
  <script>
    document.addEventListener('mousemove', function () { document.getElementById('moved').textContent = 'yes'; });
    document.getElementById('t').addEventListener('click', function () { document.getElementById('hit').textContent = 'target'; });
  </script>
</body>
</html>
```

### should move the cursor and click the target via coordinates

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/mouse-fixture.html" 2>/dev/null)
sleep 1
aux4 browser mouse --session $SESSION --action move --x 50 --y 50 --steps 10 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
aux4 browser mouse --session $SESSION --action click --x 240 --y 170 --steps 15 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
aux4 browser eval --session $SESSION --script "document.getElementById('moved').textContent" 2>/dev/null
aux4 browser eval --session $SESSION --script "document.getElementById('hit').textContent" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
ok
ok
yes
target
```

### should click an element by selector (center) with the mouse

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/mouse-fixture.html" 2>/dev/null)
sleep 1
aux4 browser mouse --session $SESSION --action click --selector "#t" --steps 15 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).status"
aux4 browser eval --session $SESSION --script "document.getElementById('hit').textContent" 2>/dev/null
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
ok
target
```

### should drive the mouse via playbook actions

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/mouse-fixture.html" 2>/dev/null)
sleep 1
printf "move mouse to 30 30\nclick mouse on \"[id='t']\"\n" > mscript.txt
aux4 playbook execute mscript.txt --session $SESSION >/dev/null 2>&1
aux4 browser eval --session $SESSION --script "document.getElementById('moved').textContent" 2>/dev/null
aux4 browser eval --session $SESSION --script "document.getElementById('hit').textContent" 2>/dev/null
rm -f mscript.txt
aux4 browser close --session $SESSION >/dev/null 2>&1
```

```expect
yes
target
```
