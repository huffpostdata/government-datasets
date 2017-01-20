#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')

// Returns file metadata by reading a headers file
function headerFileToMeta(baseDir, schema, headersPath) {
  const headersString = fs.readFileSync(`${baseDir}/${headersPath}`, 'utf-8')
  const [ getString, reqString, resString, wroteString ] = headersString.split(/\r\n\r\n/)

  const filenameM = /^wrote (.*)$/im.exec(wroteString)
  if (!filenameM) throw new Error(`Did not find body filename in string "${wroteString}"`)
  const filename = filenameM[1]

  const path = headersPath.replace(/headers$/, '') + filename
  const size = fs.statSync(`${baseDir}/${path}`).size

  const contentTypeM = /^< Content-Type:([^\r]+)$/im.exec(resString)
  const contentType = contentTypeM ? contentTypeM[1].trim() : 'application/octet-stream'

  return {
    "type": "file",
    "name": null, // we'll build it later
    "contentType": contentType,
    "size": size,
    "schema": schema,
    "path": path
  }
}

function compareIndexEntries(a, b) {
  return a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
}

function cleanIndexEntry(entry) {
  // Not recursive -- we apply this to each node within our recursion step
  switch (entry.type) {
    case 'directory':
      if (entry.nFiles === 1) {
        // A directory with a file child becomes a file
        // Assumes there are no nested directories -- which is true because we
        // already applied this step to children
        const file = entry.children[0]
        return Object.assign({}, file, {
          name: file.name === null ? entry.name : `${entry.name}/${file.name}`,
        })
      }

      const index = entry.children.find(c => c.type === 'file' && c.name === null)
      if (index) {
        index.name = '<index>';
      }
  }

  return entry
}

// Reads `dir` recursively, looking for {header,body.*} pairs.
//
// Returns an Array of:
//
//     {
//       "type": "directory",
//       "name": "xml",
//       "size": 123145,
//       "nFiles": 1,
//       "children": [
//         "type": "file",
//         "name": "some-file.csv.zip",
//         "contentType": "application/octet-stream",
//         "size": 123145,
//         "schema": "https",
//         "path": "www.example.org/xml/some-file.csv.zip/body.zip"
//       ]
//     }
//
// The Array is sorted. Directories appear first (sorted alphabetically),
// followed by files.
//
// Note that a directory and file can have the same name. For instance,
// "example.org/topic" and "example.org/topic/subtopic" could both be pages
// we download, in which case we'll return two "example.org/topic" entries.
function readIndex(baseDir, schema, dir) {
  const ret = []
  const dirPath = dir ? `${baseDir}/${dir}` : baseDir

  for (const child of fs.readdirSync(dirPath)) {
    const path = dir ? `${dir}/${child}` : child
    const stat = fs.statSync(`${baseDir}/${path}`)

    if (stat.isDirectory()) {
      const children = readIndex(baseDir, schema, path) // subdirectories ... and/or sub-files
      const nFiles = children.reduce(((s, c) => s + (c.type === 'directory' ? c.nFiles : 1)), 0)
      const size = children.reduce(((s, c) => s + c.size), 0)

      ret.push({
        type: "directory",
        name: child,
        path: path,
        children: children,
        nFiles: nFiles,
        size: size
      })
    } else if (stat.isFile() && child == 'headers') {
      ret.push(headerFileToMeta(baseDir, schema, path))
    }
  }

  ret.sort(compareIndexEntries)

  return ret.map(cleanIndexEntry)
}

function main() {
  const httpsIndex = readIndex(`${__dirname}/https`, 'https', '')
  const index = httpsIndex

  const indexJson = JSON.stringify(index)
  fs.writeFileSync(`${__dirname}/index.json`, indexJson, 'utf-8')
}

main()
