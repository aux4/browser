# page settle (BRW-009)

A page that renders its real content asynchronously after the load event
(a delayed `fetch`, plus an htmx-style `hx-get`/`hx-trigger="load"` marker)
must be fully rendered before `read`/`content`/`actions`/`snapshot`/`blocks`
or an after-action report (click/fill/type/select/check) return — not just
show the initial placeholder.

```file:settle-server.cjs
const http = require("http");

const ORDERS_HTML = "<h1>Orders</h1><table><tr><td>Order #1001</td><td>Shipped</td></tr></table><button id=\"submit\">Submit</button>";
const ALERT_HTML = "<div role=\"alert\">Order already submitted</div>";

const PAGE = "<!DOCTYPE html><html><head><title>Orders</title></head><body>"
  + "<div id=\"root\" hx-get=\"/api/orders\" hx-trigger=\"load\">Loading...</div>"
  + "<script>"
  + "window.addEventListener(\"load\", function () {"
  + "  setTimeout(function () {"
  + "    fetch(\"/api/orders\").then(function (r) { return r.text(); }).then(function (html) {"
  + "      document.getElementById(\"root\").innerHTML = html;"
  + "      document.getElementById(\"submit\").addEventListener(\"click\", function () {"
  + "        setTimeout(function () {"
  + "          fetch(\"/api/validate\").then(function (r) { return r.text(); }).then(function (html) {"
  + "            document.getElementById(\"root\").insertAdjacentHTML(\"beforeend\", html);"
  + "          });"
  + "        }, 150);"
  + "      });"
  + "    });"
  + "  }, 150);"
  + "});"
  + "</script></body></html>";

http.createServer((req, res) => {
  if (req.url === "/api/orders") {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(ORDERS_HTML);
    }, 300);
    return;
  }
  if (req.url === "/api/validate") {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(ALERT_HTML);
    }, 300);
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(PAGE);
}).listen(18458);
```

```file:settle-static.html
<!DOCTYPE html>
<html>
<head><title>Static</title></head>
<body><h1>Nothing async here</h1></body>
</html>
```

```beforeAll
nohup aux4 browser start --persistent true >/dev/null 2>&1 &
sleep 4
```

```afterAll
aux4 browser stop
pkill -f "settle-server.cjs"
```

## the page renders its order rows via a delayed fetch + htmx-style hx-get on load

### read should return the loaded order rows, not the placeholder

```timeout
30000
```

```execute
nohup node "$PWD/settle-server.cjs" >/tmp/aux4-settle-server.log 2>&1 &
sleep 1
aux4 browser read --url http://127.0.0.1:18458/ --format text | grep -o "Order #1001"
```

```expect
Order #1001
```

### content should return the loaded order rows, not the placeholder

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url http://127.0.0.1:18458/)
aux4 browser content --session $SESSION --format text | grep -o "Order #1001"
aux4 browser close --session $SESSION >/dev/null
```

```expect
Order #1001
```

### actions should list the Submit button added by the loaded content

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url http://127.0.0.1:18458/)
aux4 browser actions --session $SESSION | grep -o '"label":"Submit"'
aux4 browser close --session $SESSION >/dev/null
```

```expect
"label":"Submit"
```

### snapshot should include the loaded heading

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url http://127.0.0.1:18458/)
aux4 browser snapshot --session $SESSION | grep -o "Orders"
aux4 browser close --session $SESSION >/dev/null
```

```expect
Orders
```

### blocks should include the loaded order text

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url http://127.0.0.1:18458/)
aux4 browser blocks --session $SESSION | grep -o "Order #1001"
aux4 browser close --session $SESSION >/dev/null
```

```expect
Order #1001
```

### click's after-action report should wait for the resulting validation error to render

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url http://127.0.0.1:18458/)
aux4 browser click --session $SESSION --name Submit | grep -o "Order already submitted"
aux4 browser close --session $SESSION >/dev/null
```

```expect
Order already submitted
```

## a static page with nothing async

### read should not wait the full timeout on a page that is already settled

```timeout
30000
```

```execute
START=$(date +%s)
aux4 browser read --url "file://$PWD/settle-static.html" --format text >/dev/null
END=$(date +%s)
test $((END - START)) -lt 5 && echo fast
```

```expect
fast
```

### snapshot should not wait the full timeout on a page that is already settled

```timeout
30000
```

```execute
SESSION=$(aux4 browser open --url "file://$PWD/settle-static.html")
START=$(date +%s)
aux4 browser snapshot --session $SESSION >/dev/null
END=$(date +%s)
aux4 browser close --session $SESSION >/dev/null
test $((END - START)) -lt 5 && echo fast
```

```expect
fast
```
