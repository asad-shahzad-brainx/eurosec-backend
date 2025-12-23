'use strict'

const fp = require('fastify-plugin')
const cors = require('@fastify/cors')

/**
 * CORS Plugin
 * Enables Cross-Origin Resource Sharing (CORS) for all routes
 * Configured to allow all origins for development/integration
 */
module.exports = fp(async function (fastify, opts) {
  // Register CORS with permissive settings
  await fastify.register(cors, {
    origin: true, // Allow all origins
    credentials: true, // Allow credentials (cookies, authorization headers)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], // Allow all common methods
    allowedHeaders: [
      'Content-Type', 
      'Authorization', 
      'X-Requested-With',
      'ngrok-skip-browser-warning', // Required for ngrok tunnels
      'Accept',
      'Origin'
    ],
    exposedHeaders: ['Content-Length', 'X-Request-Id'], // Headers that can be exposed to browser
    maxAge: 86400 // Cache preflight requests for 24 hours
  })

  fastify.log.info('CORS enabled for all origins')
}, {
  name: 'cors'
})

