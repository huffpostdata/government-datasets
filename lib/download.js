'use strict'

const AWS = require('aws-sdk')
const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')
const url = require('url')

const contentDisposition = require('content-disposition')
const debug = require('debug')('download')
const mime = require('mime-types')
const url_to_dirname = require('./url_to_dirname')
const mkdirp = require('mkdirp')

const s3 = new AWS.S3()
const Bucket = 'gov-datasets.huffingtonpost.com'
const PutObjectParams = {
  ACL: 'public-read',
  Bucket: Bucket,
  CacheControl: 'public, max-age=3600',
  ServerSideEncryption: 'AES256'
}

function allowMissingIntermediateSslCertificates() {
  https.globalAgent.options.ca = Buffer.concat(fs.readdirSync(`${__dirname}/../ssl`)
    .filter(s => /\.pem$/.test(s))
    .map(s => fs.readFileSync(`${__dirname}/../ssl/${s}`))
  )
}

function pathToExt(path) {
  const m = /(\.\w{1,4})$/.exec(path)
  return m ? m[1] : ''
}

function contentTypeToExt(s) {
  const mimeExt = mime.extension(s)

  if (mimeExt === false || mimeExt === 'bin') return false

  return '.' + mimeExt
}

function contentDispositionToExt(s) {
  if (s) {
    return pathToExt(contentDisposition.parse(s).parameters.filename)
  } else {
    return ''
  }
}

// Downloads the given URL. Stores headers in the filesystem and streams the
// body to S3.
function forceDownload(urlString, headers, callback) {
  debug(`GET ${urlString}`)

  const dirname = url_to_dirname(urlString)
  mkdirp(`${__dirname}/../${dirname}`, err => {
    if (err) return callback(err)

    const parsedUrl = url.parse(urlString)
    const getOptions = Object.assign(parsedUrl, { headers: headers })
    const httpOrHttps = parsedUrl.protocol === 'https:' ? https : http

    httpOrHttps
      .get(getOptions, res => {
        function dumpHeaders(basename, callback) {
          const reqHeaders = []
          for (const key of Object.keys(headers)) {
            reqHeaders.push(`> ${key}: ${headers[key]}`)
          }

          const resHeaders = [`< Status ${res.statusCode} ${res.statusMessage}`]
          for (let i = 0; i < res.rawHeaders.length; i += 2) {
            resHeaders.push(`< ${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}`)
          }

          const meta = [
            `GET ${urlString}`,
            reqHeaders.join('\r\n'),
            resHeaders.join('\r\n'),
            `wrote ${basename}`
          ].join('\r\n\r\n')

          const headerFilename = path.join(__dirname, '..', dirname, 'headers')
          debug(`Dumping headers to ${headerFilename}`)
          fs.writeFile(headerFilename, meta, callback)
        }

        if (res.statusCode === 301 || res.statusCode === 302) {
          debug(`${res.statusCode} response => ${res.headers['location']}`)
          // Request the link we redirected to, _then_ write the headers for
          // this one. This is a bit of a hack, in case we're calling
          // forceDownload() from within a cacheLookupOrDownload():
          //
          // 1. cacheLookupOrDownload(url1, ...) => MISS
          // 2. forceDownload(url1, ...) => REDIRECT to url2
          // 3. forceDownload(url2, ...) => DATA
          //
          // If we call cacheLookupOrDownload(url1, ...) and then crash between
          // steps 2 and 3, we don't want a subsequent call to
          // cacheLookupOrDownload(url1, ...) to think there's a hit.
          //
          // The more I comment, the more I feel there should be a better way....
          return forceDownload(res.headers['location'], headers, err => {
            if (err) return callback(err)
            dumpHeaders('no content', callback)
          })
        }

        if (res.statusCode !== 200) {
          return callback(new Error(`${url} returned status code ${res.statusCode}`))
        }

        const ext = (
          contentDispositionToExt(res.headers['content-disposition']) ||
          contentTypeToExt(res.headers['content-type']) ||
          pathToExt(url.parse(urlString).pathname) ||
          ''
        )
        const basename = `body${ext}`
        const filename = path.join(dirname, basename)

        // Write to bucket before writing headers: that way headers prove the
        // existence of the file
        debug(`Streaming to s3://${Bucket}/${filename}`)

        let errored = false
        res.on('error', err => { errored = true; callback(err) })
        s3.upload(Object.assign({}, PutObjectParams, {
          Key: filename,
          Body: res,
          ContentType: res.headers['content-type'],
          ContentDisposition: res.headers['content-disposition']
        }), err => {
          if (errored) return
          dumpHeaders(basename, err => {
            if (err) return callback(err)

            // HACK: give the server breathing room
            setTimeout((() => callback(null)), 1000)
          })
        })
      })
      .on('error', callback)
  })
}

function readHeaderFile(urlString, callback) {
  const dirname = url_to_dirname(urlString)
  const headersFilename = `${__dirname}/../${dirname}/headers`
  fs.readFile(headersFilename, 'utf-8', callback)
}

// Calls `callback` as:
//
// * callback(err) on error (filesystem error, HTTP error or integrity error)
// * callback(null, stream) on cache hit. The response is an
//   http.IncomingMessage: it is a ReadableStream with a destroy() method
// * callback(null, null) on cache miss
function getStreamFromCache(urlString, callback) {
  const dirname = url_to_dirname(urlString)

  readHeaderFile(urlString, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        return callback(null, null)
      }
      return callback(err)
    }

    const redirectM = /^< location:\s*([^\s]+)/im.exec(data)
    if (redirectM) {
      return getStreamFromCache(redirectM[1], callback)
    }

    const m = /^wrote (body.*)$/im.exec(data)
    if (!m) {
      return callback(new Error(`${dirname}/headers does not specify the filename it wrote`))
    }
    const key = `${dirname}/${m[1]}`

    http.get(`http://${Bucket}.s3.amazonaws.com/${key}`, res => {
      return callback(null, res)
    })
      .on('error', callback)
  })
}

// Streams the given URL to S3 if it is not there; calls callback(err, stream)
// where stream is the body from S3
function cacheLookupOrDownload(urlString, headers, callback) {
  debug(`cache-lookup ${urlString}`)

  getStreamFromCache(urlString, (err, stream) => {
    if (err) return callback(err)
    if (stream) return callback(null, stream)

    forceDownload(urlString, headers, err => {
      if (err) return callback(err)

      getStreamFromCache(urlString, (err, stream) => {
        if (err) return callback(err)
        if (!stream) return callback(new Error('assertion failure: forceDownload() failed to force a download or report an error'))

        return callback(null, stream)
      })
    })
  })
}

// Streams the given URL to S3 if it is not there; calls callback(err)
function ensureInCache(urlString, headers, callback) {
  getStreamFromCache(urlString, (err, stream) => {
    if (err) return callback(err)
    if (stream) {
      stream.destroy()
      return callback(null)
    }

    forceDownload(urlString, headers, callback)
  })
}

function ensureInCacheQuick(urlString, headers, callback) {
  debug(`cache-check ${urlString}`)

  readHeaderFile(urlString, (err, data) => {
    if (err && err.code === 'ENOENT') return forceDownload(urlString, headers, callback)
    if (err) return callback(err)
    return callback(null)
  })
}

module.exports = forceDownload
module.exports.ensureInCache = ensureInCache
module.exports.ensureInCacheQuick = ensureInCacheQuick
module.exports.downloadThroughCache = cacheLookupOrDownload
module.exports.allowMissingIntermediateSslCertificates = allowMissingIntermediateSslCertificates
