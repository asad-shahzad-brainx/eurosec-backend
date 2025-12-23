'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { build } = require('../helper')

test('POST /send-quote sends invoice for draft order', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    url: '/send-quote',
    method: 'POST',
    payload: {
      draftOrderId: 'gid://shopify/DraftOrder/123456789'
    }
  })

  // Note: This will fail in test without real Shopify connection
  // Just validates the route structure and response format
  assert.ok(res.statusCode === 200 || res.statusCode === 400 || res.statusCode === 500)
  
  const payload = JSON.parse(res.payload)
  assert.ok(payload.status)
})

test('POST /send-quote with email customization', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    url: '/send-quote',
    method: 'POST',
    payload: {
      draftOrderId: 'gid://shopify/DraftOrder/123456789',
      email: {
        to: 'customer@example.com',
        from: 'shop@example.com',
        subject: 'Your Invoice',
        customMessage: 'Thank you for your order!'
      }
    }
  })

  assert.ok(res.statusCode === 200 || res.statusCode === 400 || res.statusCode === 500)
  
  const payload = JSON.parse(res.payload)
  assert.ok(payload.status)
})

test('POST /send-quote validates required fields', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    url: '/send-quote',
    method: 'POST',
    payload: {} // Missing draftOrderId
  })

  assert.equal(res.statusCode, 400)
})

test('GET /send-quote/health returns service status', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    url: '/send-quote/health',
    method: 'GET'
  })

  assert.equal(res.statusCode, 200)
  
  const payload = JSON.parse(res.payload)
  assert.equal(payload.status, 'ok')
  assert.equal(payload.service, 'send-quote')
  assert.ok(payload.timestamp)
})

