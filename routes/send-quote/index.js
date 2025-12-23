'use strict'

/**
 * Send Quote Routes
 * Send invoice emails for draft orders
 */
module.exports = async function (fastify, opts) {
  // Request payload schema
  const sendQuotePayloadSchema = {
    type: 'object',
    required: ['draftOrderId'],
    properties: {
      draftOrderId: {
        type: 'string',
        description: 'Shopify draft order GID (e.g., gid://shopify/DraftOrder/123456789)'
      },
      email: {
        type: 'object',
        description: 'Optional email customization',
        properties: {
          to: {
            type: 'string',
            format: 'email',
            description: 'Email recipient address'
          },
          from: {
            type: 'string',
            format: 'email',
            description: 'Email sender address'
          },
          bcc: {
            type: 'array',
            items: {
              type: 'string',
              format: 'email'
            },
            description: 'BCC recipients (must be staff accounts)'
          },
          subject: {
            type: 'string',
            description: 'Email subject line'
          },
          customMessage: {
            type: 'string',
            description: 'Custom message to include in email body'
          }
        }
      }
    }
  }

  // POST /send-quote - Send invoice email for a draft order
  fastify.post('/', {
    schema: {
      description: 'Send an invoice email for a draft order. Triggers the draftOrderInvoiceSend mutation. ' +
                   'Optionally customize email fields (to, from, bcc, subject, customMessage).',
      tags: ['send-quote'],
      body: sendQuotePayloadSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            draftOrder: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                invoiceSentAt: { type: ['string', 'null'] },
                invoiceUrl: { type: ['string', 'null'] }
              }
            }
          }
        },
        400: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            error: { type: 'string' }
          }
        },
        500: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            error: { type: 'string' }
          }
        }
      }
    }
  }, async function (request, reply) {
    try {
      // Check if services are available
      if (!fastify.services || !fastify.services.draftOrder) {
        reply.code(500)
        return {
          status: 'error',
          error: 'Shopify services not configured'
        }
      }

      const { draftOrderId, email } = request.body

      // Log the incoming request
      fastify.log.info({
        draftOrderId,
        hasEmailCustomization: !!email
      }, 'Sending invoice for draft order')

      // Send invoice using draft order service
      const result = await fastify.services.draftOrder.sendInvoice(draftOrderId, email)

      // Return success response
      reply.code(200)
      return {
        status: 'success',
        draftOrder: result
      }
    } catch (error) {
      fastify.log.error({ error }, 'Failed to send invoice')

      // Determine if it's a validation error or server error
      if (error.message.includes('not found') || 
          error.message.includes('not configured') ||
          error.message.includes('user errors')) {
        reply.code(400)
        return {
          status: 'error',
          error: error.message
        }
      }

      // Server error
      reply.code(500)
      return {
        status: 'error',
        error: error.message
      }
    }
  })

  // GET /send-quote/health - Health check endpoint
  fastify.get('/health', {
    schema: {
      description: 'Health check endpoint for send quote service',
      tags: ['send-quote'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            service: { type: 'string' },
            shopifyAdmin: { type: 'string' },
            timestamp: { type: 'string' }
          }
        }
      }
    }
  }, async function (request, reply) {
    const adminEnabled = !!(fastify.services && fastify.services.draftOrder)
    
    return {
      status: 'ok',
      service: 'send-quote',
      shopifyAdmin: adminEnabled ? 'enabled' : 'not_configured',
      timestamp: new Date().toISOString()
    }
  })
}

