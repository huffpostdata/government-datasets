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

  return ret
}

// Merges directory structures recursively
//
// If a file exists in both a and b, the file in b will be ignored
function mergeIndexes(a, b) {
  const ret = []

  let i = 0
  let j = 0

  while (i < a.length || j < b.length) {
    if (i === a.length) {
      ret.splice(ret.length, 0, ...b.slice(j))
      j = b.length
    } else if (j === b.length) {
      ret.splice(ret.length, 0, ...a.slice(i))
      i = a.length
    } else {
      const c = compareIndexEntries(a[i], b[j])

      if (c < 0) {
        ret.push(a[i]);
        i += 1;
      } else if (c === 0) {
        // a[i] and b[j] have the same type (otherwises c !== 0)
        if (a[i].type === 'directory') {
          ret.push(Object.assign({}, a[i], {
            children: mergeIndexes(a[i].children, b[j].children),
            nFiles: a[i].nFiles + b[j].nFiles,
            size: a[i].size + b[j].size
          }))
        } else {
          ret.push(a[i]) // conflicting filenames
        }
        i += 1;
        j += 1;
      } else {
        ret.push(b[j]);
        j += 1;
      }
    }
  }

  return ret
}

// Raises each leaf entry that has no siblings.
//
// Each dir/file becomes a file.
//
// This is crucial because on the filesystem, directories and files look the
// same at a glance: we have to read a `headers` file just to spot the
// difference. So the original indexing gives all files the name `null`. This
// step corrects that error.
function cleanIndex(index) {
  return index.map(cleanIndexEntry)
}

// Used by cleanIndex()
//
// A "clean" index entry satisfies these constraints:
// * If the entry is a file, its `name` may be `null`
// * If the entry is a directory, it contains >1 files
// * If the entry is a directory, it contains no files with `name === null`
function cleanIndexEntry(entry) {
  if (entry.type === 'directory') {
    // post-order recursion: clean the child nodes, so we can assume all child
    // nodes are clean
    const cleanChildren = cleanIndex(entry.children)

    // A directory must contain >1 files; otherwise, put a file instead. (The
    // file will never have a `null` name)
    if (entry.nFiles === 1) {
      const file = cleanChildren[0]
      return Object.assign({}, file, {
        name: file.name === null ? entry.name : `${entry.name}/${file.name}`
      })
    }

    // No children can have `null` name: put `"<index>"` instead
    return Object.assign({}, entry, { children: cleanChildren.map(c => {
      if (c.name === null) {
        return Object.assign({}, c, { name: '<index>' })
      } else {
        return c
      }
    })})
  } else {
    return entry
  }
}

function main() {
  const httpsIndex = readIndex(`${__dirname}/https`, 'https', '')
  const httpIndex = readIndex(`${__dirname}/http`, 'http', '')
  const mergedIndex = mergeIndexes(httpsIndex, httpIndex)
  const cleanedIndex = cleanIndex(mergedIndex)

  const indexJson = JSON.stringify(cleanedIndex)
  fs.writeFileSync(`${__dirname}/index.json`, indexJson, 'utf-8')
}

main()
