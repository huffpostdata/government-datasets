#!/usr/bin/env node

'use strict'

const async = require('async')
const debug = require('debug')('www.epa.gov')
const request = require('request')
const cheerio = require('cheerio')

const download = require('../lib/download')

const Headers = {
  'User-Agent': 'Huffington Post scraper; please contact adam.hooper@huffingtonpost.com if it inconveniences you'
}

// Calls callback(err, text)
function cachedDownloadBody(url, callback) {
  download.downloadThroughCache(url, Headers, (err, stream) => {
    if (err) return callback(err)

    const parts = []
    let errored = false

    stream.on('error', err => {
      errored = true
      stream.destroy()
      return callback(err)
    })

    stream.on('data', part => parts.push(part))
    stream.on('end', () => {
      if (errored) return

      const bytes = Buffer.concat(parts)
      return callback(null, bytes.toString('utf-8'))
    })
  })
}

// Calls callback(err)
function cachedEnsureDownloaded(url, callback) {
  download.ensureInCacheQuick(url, Headers, callback)
}

function urlToCheerio(url, callback) {
  cachedDownloadBody(url, (err, body) => {
    if (err) return callback(err)

    let $

    try {
      $ = cheerio.load(body)
    } catch (err) {
      return callback(err)
    }

    return callback(null, $) // don't put this in try{} -- it may throw if code is erroneous
  })
}

function hrefToUrl(href) {
  if (/https?:\/\//.test(href)) {
    return href
  } else {
    return `https://www.epa.gov${href}`
  }
}

// Calls callback(err, urls), where urls is a list of report URLs from the
// given list-of-reports URL.
//
// Example URL: https://www.epa.gov/office-inspector-general/2016-oig-reports
// ... will return a bunch of URLs to HTML pages
function loadOigIndex(url, callback) {
  debug(`Loading report index page ${url}`)
  urlToCheerio(url, (err, $) => {
    if (err) return callback(err)

    const urls = []
    $('table a, li>em>a').each((i, a) => {
      const href = $(a).attr('href')
      urls.push(hrefToUrl(href))
    })

    return callback(null, urls)
  })
}

// Calls callback(err, urls), where urls is a list of report URLs from the
// given report-metadata URL
//
// Example URL: https://www.epa.gov/office-inspector-general/report-epas-tracking-and-reporting-its-conference-costs-need-improvement
// ... will return two URLs:
// * https://www.epa.gov/sites/production/files/2016-01/documents/20160107-16-p-0081_glance.pdf
// * https://www.epa.gov/sites/production/files/2016-01/documents/20160107-16-p-0081.pdf
function loadOigMeta(url, callback) {
  debug(`Loading report meta page ${url}`)
  urlToCheerio(url, (err, $) => {
    if (err) return callback(err)

    const urls = []
    $('a.file-link').each((i, a) => {
      const href = $(a).attr('href')
      urls.push(hrefToUrl(href))
    })

    return callback(null, urls)
  })
}

// Downloads an index page of OIG Reports and returns an Array of URLs of
// reports
function listOigReports(url, callback) {
  loadOigIndex(url, (err, metaUrls) => {
    if (err) return callback(err)

    async.mapSeries(metaUrls, loadOigMeta, (err, reportUrlArrays) => {
      if (err) return callback(err)
      return callback(null, [].concat(...reportUrlArrays))
    })
  })
}

const OigReportIndexPages = [
//  'https://www.epa.gov/office-inspector-general/2016-oig-reports',
//  'https://www.epa.gov/office-inspector-general/2015-oig-reports',
//  'https://www.epa.gov/office-inspector-general/2014-oig-reports',
//  'https://www.epa.gov/office-inspector-general/2013-oig-reports',
//  'https://www.epa.gov/office-inspector-general/2012-oig-reports',
//  'https://www.epa.gov/office-inspector-general/2011-oig-reports',
//  'https://www.epa.gov/office-inspector-general/2010-oig-reports',
//  'https://www.epa.gov/office-inspector-general/2009-oig-reports',
//  'https://www.epa.gov/office-inspector-general/2008-oig-reports',
//  'https://www.epa.gov/office-inspector-general/2007-oig-reports',
//  'https://www.epa.gov/office-inspector-general/2006-oig-reports',
//  'https://www.epa.gov/office-inspector-general/2005-oig-reports',
//  'https://www.epa.gov/office-inspector-general/2004-oig-reports',
//  'https://www.epa.gov/office-inspector-general/2003-oig-reports',
//  'https://www.epa.gov/office-inspector-general/2002-oig-reports',
//  'https://www.epa.gov/office-inspector-general/2001-oig-reports',
//  'https://www.epa.gov/office-inspector-general/2000-oig-reports',
//  'https://www.epa.gov/office-inspector-general/planning-and-performance-documents',
//  'https://www.epa.gov/ghgemissions/us-greenhouse-gas-inventory-report-archive'
]

const OigReportPdfIndexPages = [
//  'https://www.epa.gov/office-inspector-general/1999-1996-oig-reports',
//  'https://www.epa.gov/office-inspector-general/congressionally-requested-oig-reports',
//  'https://www.epa.gov/office-inspector-general/oig-reports-chemical-safety-board',
  'https://www.epa.gov/natural-gas-star-program/methane-emissions-natural-gas-industry'
]

function loadAllOigReportUrls(callback) {
  async.mapSeries(OigReportIndexPages, listOigReports, (err, urlArrays) => {
    if (err) return callback(err)

    // OigReportPdfIndexPages have "file" links -- just like the meta pages
    async.mapSeries(OigReportPdfIndexPages, loadOigMeta, (err, moreUrlArrays) => {
      if (err) return callback(err)

      const allUrls = [].concat(...urlArrays).concat(...moreUrlArrays)
      return callback(null, allUrls)
    })
  })
}

loadAllOigReportUrls((err, urls) => {
  if (err) throw err

  async.eachSeries(urls, cachedEnsureDownloaded, err => {
    if (err) throw err
  })
})
