#!/usr/bin/env node

'use strict'

const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')
const url = require('url')

const contentDisposition = require('content-disposition')
const debug = require('debug')('download-url')
const mime = require('mime-types')
const url_to_dirname = require('./lib/url_to_dirname')
const mkdirp = require('mkdirp')

function allowMissingIntermediateSslCertificates() {
  https.globalAgent.options.ca = Buffer.concat(fs.readdirSync(`${__dirname}/ssl`)
    .filter(s => /\.pem$/.test(s))
    .map(s => fs.readFileSync(`${__dirname}/ssl/${s}`))
  )
}

function pathToExt(path) {
  const m = /(\.\w{1,4})$/.exec(path)
  return m ? m[1] : ''
}

function contentTypeToExt(s) {
  const mimeExt = mime.extension(s)

  if (mimeExt === false) return false

  const ret = `.${mime.extension(s)}`
  return ret === '.bin' ? '' : ret
}

function contentDispositionToExt(s) {
  if (s) {
    return pathToExt(contentDisposition.parse(s).parameters.filename)
  } else {
    return ''
  }
}

function doDownload(urlString, callback) {
  const dirname = url_to_dirname(urlString)
  mkdirp(dirname, err => {
    if (err) return callback(err)

    let bodyStream = null

    debug(`GET ${urlString}`)

    const httpOrHttps = (urlString.slice(0, 5) === 'https' ? https : http)

    httpOrHttps
      .get(urlString, res => {
        const ext = (
          contentDispositionToExt(res.headers['content-disposition']) ||
          contentTypeToExt(res.headers['content-type']) ||
          pathToExt(url.parse(urlString).pathname) ||
          ''
        )
        const basename = `body${ext}`
        const filename = path.join(dirname, basename)

        const headers = [`< Status ${res.statusCode} ${res.statusMessage}`]
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          headers.push(`< ${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}`)
        }

        const meta = [
          `GET ${urlString}`,
          '',
          headers.join('\r\n'),
          `wrote ${basename}`
        ].join('\r\n\r\n')

        fs.writeFile(path.join(dirname, 'headers'), meta, err => {
          if (err) callback(err) // TODO think through errors

          debug(`Streaming to ${filename}`)

          res.pipe(fs.createWriteStream(filename))
            .on('error', callback) // TODO think through errors
            .on('finish', callback)
        })
      })
      .on('error', callback)
  })
}

allowMissingIntermediateSslCertificates()

const urls = process.argv.slice(2)
function step() {
  if (urls.length === 0) return

  doDownload(urls.shift(), err => {
    if (err) throw err
    process.nextTick(step)
  })
}
step()
