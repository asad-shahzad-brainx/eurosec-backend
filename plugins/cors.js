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
    origin: process.env.NODE_ENV === 'production' ? process.env.CORS_ORIGIN.split(',') : true, 
    credentials: true, 
    methods: ['GET', 'POST'], 
    allowedHeaders: [
      'Content-Type', 
      'Authorization', 
      'X-Requested-With',
      'ngrok-skip-browser-warning', 
      'Accept',
      'Origin'
    ],
    exposedHeaders: ['Content-Length', 'X-Request-Id'], 
    maxAge: 86400 
  })

  fastify.log.info('CORS enabled for all origins')
}, {
  name: 'cors'
})

