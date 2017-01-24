#!/usr/bin/env node

'use strict'

// Downloads all NCES "Publications and Products" from
// https://nces.ed.gov/pubsearch/index.asp

const cheerio = require('cheerio')
const debug = require('debug')('nces.ed.gov')
const download = require('../lib/download').ensureInCache
const fs = require('fs')
const ms = require('ms')

function downloadSync(urls) {
  child_process.execFileSync(
    `${__dirname}/../download-url.js`,
    urls,
    {
      cwd: `${__dirname}/..`,
      env: { DEBUG: process.env.DEBUG }
    }
  )
}

function downloadReports(callback) {
  debug('Downloading published reports (pubsearch)...')

  // The index page comes from https://nces.ed.gov/pubsearch/index.asp?PubSectionID=1&HasSearched=1&pubspagenum=1&sort=3&pagesize=10000
  // We download it to ./data/nces.ed.gov/pubsearch.html
  const html = fs.readFileSync(`${__dirname}/data/nces.ed.gov/pubsearch.html`, 'utf-8')

  // Find each pubid by scraping the index page for links
  const pubids = [] // Array of Strings
  const pubidRe = /<a href="pubsinfo\.asp\?pubid=(\d+)">/g
  let m
  while ((m = pubidRe.exec(html)) !== null) {
    const pubid = m[1]
    pubids.push(pubid)
  }

  const nTotal = pubids.length
  const date1 = new Date()

  function step() {
    if (pubids.length === 0) return callback(null)

    const pubid = pubids.shift()

    const tDiff = new Date() - date1
    const n = nTotal - pubids.length
    const tTotal = tDiff * (nTotal / (n + 1))
    const tRemaining = tTotal - tDiff
    debug(`Download ${n} of ${nTotal} (est. ${ms(tRemaining)} remaining)...`)

    const href = `https://nces.ed.gov/pubs${pubid.slice(0, pubid.length > 5 ? 4 : 2)}/${pubid}.pdf`
    download(href, {}, err => {
      if (err) return callback(err)
      process.nextTick(step)
    })
  }
  step()
}

function downloadIpedsDataFiles(callback) {
  debug('Downloading IPEDS data...')

  // The index page only comes through a form submit. To get it:
  //
  // 1. Browse to https://nces.ed.gov/ipeds/Home/UseTheData
  // 2. In the "Survey Data" <select>, choose "Complete data files"
  // 3. Hit "Continue" (so "All years" and "All surveys" are selected)
  // 4. Save that page to ./data/nces.ed.gov/IPEDS Data Center.html
  const html = fs.readFileSync(`${__dirname}/data/nces.ed.gov/IPEDS Data Center.html`, 'utf-8')
  const $ = cheerio.load(html)
  const hrefs = []
  $('tr.idc_gridviewrow').each((_, row) => {
    const csvTd = $(row).children()[3]
    hrefs.push($(csvTd).find('a').attr('href'))

    const dictTd = $(row).children()[6]
    hrefs.push($(dictTd).find('a').attr('href'))
  })

  function step() {
    if (hrefs.length === 0) return callback(null)
    const href = hrefs.shift()
    download(href, {}, err => {
      if (err) return callback(err)
      process.nextTick(step)
    })
  }
  step()
}

downloadReports(err => {
  if (err) throw err

  downloadIpedsDataFiles(err => {
    if (err) throw err
  })
})
