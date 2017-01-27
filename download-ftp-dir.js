#!/usr/bin/env node

'use strict'

const AWS = require('aws-sdk')
const async = require('async')
const debug = require('debug')('download-ftp-dir')
const fs = require('fs')
const ftp = require('ftp')
const url = require('url')
const path = require('path')
const mime = require('mime-types')
const mkdirp = require('mkdirp')

const url_to_dirname = require('./lib/url_to_dirname')

const s3 = new AWS.S3()
const Bucket = 'gov-datasets.huffingtonpost.com'

function pathToExt(path) {
  const m = /(\.\w{1,4})$/.exec(path)
  return m ? m[1] : ''
}

function pathToContentType(path) {
  return mime.lookup(path) || 'application/octet-stream'
}

function downloadEntry(ftpClient, parentPath, entry, callback) {
  const path = `${parentPath}/${entry.name}`

  if (entry.type === 'd') {
    return downloadDir(ftpClient, path, callback)
  } else if (entry.type === '-') {
    return downloadFile(ftpClient, path, callback)
  } else {
    return callback(new Error(`Unexpected "type" in entry ${JSON.stringify(entry)}`))
  }
}

function downloadDir(ftpClient, path, callback) {
  debug(`listing directory ${path}`)
  ftpClient.list(`/${path}`, (err, entries) => {
    if (err) return callback(err)

    async.eachSeries(entries, ((entry, next) => downloadEntry(ftpClient, path, entry, next)), callback)
  })
}

function forceDownloadFile(ftpClient, path, callback) {
  const dirname = `${__dirname}/ftp/${ftpClient.options.host}/${path}`
  const basename = `body${pathToExt(path)}`
  const headerFilename = `${dirname}/headers`

  function dumpHeaders(callback) {
    const meta = `GET ${path}\r\n\r\n\r\n\r\n< Content-Type: ${pathToContentType(path)}\r\n\r\nwrote ${basename}`
    debug(`Dumping headers to ${headerFilename}`)
    fs.writeFile(headerFilename, meta, callback)
  }

  mkdirp(dirname, err => {
    if (err) return callback(err)

    ftpClient.get(`/${path}`, (err, stream) => {
      if (err) return callback(err)

      debug(`Streaming to s3://${Bucket}/ftp/${path}`)

      let errored = false
      stream.on('error', err => { errored = true; callback(err) })
      s3.upload({
        ACL: 'public-read',
        Bucket: Bucket,
        CacheControl: 'public, max-age=3600',
        ServerSideEncryption: 'AES256',
        Key: `ftp/${path}/${basename}`,
        Body: stream,
        ContentType: pathToContentType(path)
      }, err => {
        if (errored) return
        if (err) return callback(err)
        dumpHeaders(callback)
      })
    })
  })
}

function downloadFile(ftpClient, path, callback) {
  debug(`downloading file ${path}...`)

  const dirname = `${__dirname}/ftp/${ftpClient.options.host}/${path}`
  const basename = `body${pathToExt(path)}`
  const headerFilename = `${dirname}/headers`

  function dumpHeaders(callback) {
    const meta = `GET ${path}\r\n\r\n\r\n\r\n< Content-Type: ${pathToContentType(path)}\r\n\r\nwrote ${basename}`
    debug(`Dumping headers to ${headerFilename}`)
    fs.writeFile(headerFilename, meta, callback)
  }

  fs.readFile(headerFilename, 'utf-8', (err, data) => {
    if (err && err.code === 'ENOENT') {
      return forceDownloadFile(ftpClient, path, callback)
    }

    if (err) return callback(err)

    debug(`Already downloaded ${path}, skipping...`)
    return callback(null)
  })
}

function main(rootUrl, callback) {
  const ftpOptions = url.parse(rootUrl)
  const path = ftpOptions.path.replace(/^\/|\/$/g, '') // /pub/data/gridded-nw-pac/ => pub/data/gridded-nw-pac

  let errored = false
  const client = new ftp()
  client.on('ready', () => {
    downloadDir(client, path, err => {
      client.end()

      if (errored) return
      if (!err) return // 'end' will fire soon
      errored = true
      return callback(err)
    })
  })
  client.on('error', err => {
    if (errored === true) return
    errored = true
    return callback(err)
  })
  client.on('close', hadErr => {
    if (errored === true) return
    if (hadErr) return callback(new Error("ftp.close() reported an error that we didn't see"))
    return callback(null)
  })
  client.connect(ftpOptions)
}

async.eachSeries(process.argv.slice(2), main, err => {
  if (err) throw err
})
