'use strict'

const path = require('path')
const url = require('url')

function makePathComponentSafe(name) {
  return name
    .replace(/[\x00-\x1f<>:"/\\|?*%]/, encodeURIComponent)
}

module.exports = function url_to_dirname(urlString) {
  const u = url.parse(urlString)

  const parts = u.path.split(/\/+/)
  parts.unshift(u.host)
  parts.unshift(u.protocol.replace(':', ''))

  const safeParts = parts.map(makePathComponentSafe)

  return path.join(...safeParts)
}
