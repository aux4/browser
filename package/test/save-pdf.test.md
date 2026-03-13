# Save PDF

## save page as pdf with default options

```timeout
30000
```

```execute
aux4 browser start --persistent true > /dev/null 2>&1 &
sleep 4
SESSION=$(aux4 browser open --url https://example.com 2>/dev/null)
sleep 1
aux4 browser save-pdf --session $SESSION --output /tmp/aux4-test-save-pdf.pdf 2>/dev/null
FILE_TYPE=$(file /tmp/aux4-test-save-pdf.pdf | grep -o PDF)
echo "type:$FILE_TYPE"
aux4 browser close --session $SESSION > /dev/null 2>&1
aux4 browser stop > /dev/null 2>&1
rm -f /tmp/aux4-test-save-pdf.pdf
```

```expect:partial
/tmp/aux4-test-save-pdf.pdf
type:PDF
```

## save page as pdf with format and printBackground

```timeout
30000
```

```execute
aux4 browser start --persistent true > /dev/null 2>&1 &
sleep 4
SESSION=$(aux4 browser open --url https://example.com 2>/dev/null)
sleep 1
aux4 browser save-pdf --session $SESSION --output /tmp/aux4-test-save-pdf-a4.pdf --format A4 --printBackground true 2>/dev/null
FILE_TYPE=$(file /tmp/aux4-test-save-pdf-a4.pdf | grep -o PDF)
echo "type:$FILE_TYPE"
aux4 browser close --session $SESSION > /dev/null 2>&1
aux4 browser stop > /dev/null 2>&1
rm -f /tmp/aux4-test-save-pdf-a4.pdf
```

```expect:partial
/tmp/aux4-test-save-pdf-a4.pdf
type:PDF
```
