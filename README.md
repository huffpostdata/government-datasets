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
