government-datasets
===================

A selective mirror of the Internet.

Browse here: https://pages.git.huffpo.net/huffpostdata/government-datasets/

Filesystem structure
--------------------

A URL looks like this:

`https://foo.gov/a/b/c/d.php?q=blah`

That will map to two files:

1. `https/foo.gov/a/b/c/d.php%3Fq=blah/headers` will contains A) `GET [url]`,
   utf8-encoded; B) the raw HTTP request headers, `> `-prefixed; C) the raw HTTP
   response headers, `< `-prefixed; D) `wrote [basename]`, the output filename
   that starts with `body`
2. `https/foo.gov/a/b/c/d.php%3Fq=blah/body[.ext]` will show the response body
   (which may be blank). The `.ext` will be determined from the first value
   found of A) the `Content-Disposition` response header's `filename=`
   extension; B) the `Content-Type` response header; C) the extension of the
   URL `pathname` (the part before the query string -- may be blank).

./download-url.js
-----------------

Usage: `./download-url.js URL1 [URL2 ...]`

You can copy/paste these URLs from your browser's location bar: be sure to quote
them. Also, if you're on a page that has lots of "downloads", open up a
JavaScript console and type this to find a list of quoted download URLs from the
HTML:

```javascript
let Selector = 'zip pdf xls xlsx txt gz doc docx sps sas'
  .split(' ')
  .map(ext => `a[href$=".${ext}"]`)
  .join(', ')
console.log(
  Array.prototype.map.call(
    document.querySelectorAll(Selector),
    a => `"${a.href}"`
  ).join(' ')
)
```
