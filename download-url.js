#!/usr/bin/env node

'use strict'

const download = require('./lib/download')

download.allowMissingIntermediateSslCertificates()

const urls = process.argv.slice(2)
function step() {
  if (urls.length === 0) return

  download(urls.shift(), {}, err => {
    if (err) throw err
    process.nextTick(step)
  })
}
step()
