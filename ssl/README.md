Holds intermediate certificates -- for when websites are misconfigured.

To add a new one, e.g. for `enfxfr.dol.gov`

1. `echo '' | openssl s_client -showcerts -connect enfxfr.dol.gov:443 -servername enfxfr.dol.gov`
2. Copy/paste the certificate (from `BEGIN` line to `END` line, inclusive) into https://certificatechain.io/
3. Copy/paste the output into `enfxfr.dol.gov.pem`
