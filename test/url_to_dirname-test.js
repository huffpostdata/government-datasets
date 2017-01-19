'use strict'

const expect = require('chai').expect
const url_to_dirname = require('../lib/url_to_dirname')

describe('url_to_dirname', () => {
  it('should choose the right dirname', () => {
    expect(url_to_dirname('http://example.org/foo'))
      .to.eq('http/example.org/foo')
  })

  it('should escape a basename', () => {
    expect(url_to_dirname('http://t.co/foo/bar:baz'))
      .to.eq('http/t.co/foo/bar%3Abaz')
  })

  it('should escape a "%" in a basename', () => {
    expect(url_to_dirname('http://t.co/foo/bar%3Abaz'))
      .to.eq('http/t.co/foo/bar%253Abaz')
  })

  it('should ignore the anchor part of a URL', () => {
    expect(url_to_dirname('http://example.org/foo#details'))
      .to.eq('http/example.org/foo')
  })
})
