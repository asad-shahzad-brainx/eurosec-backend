'use strict'

/**
 * Print Quote Routes
 * Generate VAT invoice PDFs and upload them to Shopify CDN
 */
module.exports = async function (fastify, opts) {
  // Request payload schema
  const printQuotePayloadSchema = {
    type: 'object',
    required: ['cartLines'],
    properties: {
      checkoutToken: { type: 'string' },
      cartToken: { type: 'string' },
      cartLines: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['quantity', 'variantId'],
          properties: {
            id: { type: 'string' },
            quantity: { type: 'integer', minimum: 1 },
            title: { type: 'string' },
            variantTitle: { type: 'string' },
            price: { type: 'number' },
            image: { type: 'string' },
            productId: { type: 'string' },
            variantId: { type: 'string' },
            sku: { type: 'string' },
            properties: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  value: { type: 'string' }
                }
              }
            }
          }
        }
      },
      customer: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string', format: 'email' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          phone: { type: 'string' }
        }
      },
      pricing: {
        type: 'object',
        properties: {
          subtotal: { type: 'number' },
          total: { type: 'number' },
          currency: { type: 'string' },
          discountCodes: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      },
      shippingAddress: {
        type: 'object',
        properties: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          address1: { type: 'string' },
          address2: { type: 'string' },
          city: { type: 'string' },
          province: { type: 'string' },
          provinceCode: { type: 'string' },
          country: { type: 'string' },
          countryCode: { type: 'string' },
          zip: { type: 'string' },
          phone: { type: 'string' },
          company: { type: 'string' }
        }
      },
      billingAddress: {
        type: 'object',
        properties: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          address1: { type: 'string' },
          address2: { type: 'string' },
          city: { type: 'string' },
          province: { type: 'string' },
          provinceCode: { type: 'string' },
          country: { type: 'string' },
          countryCode: { type: 'string' },
          zip: { type: 'string' },
          phone: { type: 'string' },
          company: { type: 'string' }
        }
      },
      note: { type: 'string' },
      locale: { type: 'string' },
      shop: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          domain: { type: 'string' }
        }
      },
      timestamp: { type: 'string' }
    }
  }

  // POST /print-quote - Create a draft order and generate VAT Invoice PDF
  fastify.post('/', {
    schema: {
      description: 'Generate a VAT Invoice PDF from cart data. Creates a draft order. Triggers invoice sending and PDF generation in background. Returns immediately.',
      tags: ['print-quote'],
      body: printQuotePayloadSchema,
      response: {
        201: {
          type: 'object',
          properties: {
            status: { type: 'string' },
          }
        },
        400: {
          type: 'object',
          required: ['status', 'url'],
          properties: {
            status: { type: 'string' },
            url: { type: 'null' },
            error: { type: 'string' }
          }
        },
        500: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            url: { type: 'null' },
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
          url: null,
          error: 'Shopify services not configured'
        }
      }

      const payload = request.body

      // Log the incoming request
      fastify.log.info({
        checkoutToken: payload.checkoutToken,
        cartToken: payload.cartToken,
        lineItemsCount: payload.cartLines?.length,
        hasCustomer: !!payload.customer?.email
      }, 'Creating print quote with draft order')

      // Step 1: Create draft order
      const draftOrder = await fastify.services.draftOrder.processCheckoutData(payload)

      // Step 2: Return response immediately
      reply.code(201).send({
        status: 'success',
      })

      // Step 3: Background operations (Send Invoice & Generate PDF)
      ;(async () => {
        try {
          fastify.log.info({ draftOrderId: draftOrder.id }, 'Starting background operations for print quote')

          // Generate and attach PDF using shared service
          if (fastify.services.invoicePdf) {
            await fastify.services.invoicePdf.generateAndAttachPdf(draftOrder, payload)
          }

          // Trigger send invoice mutation
          const bccEmail = fastify.config.invoice.bccEmail
          await fastify.services.draftOrder.sendInvoice(draftOrder.id, {
            bcc: bccEmail ? [bccEmail] : []
          })

          fastify.log.info({ draftOrderId: draftOrder.id }, 'Background operations completed successfully')
        } catch (error) {
          fastify.log.error({ error, draftOrderId: draftOrder.id }, 'Background operations failed')
        }
      })()

      return reply
    } catch (error) {
      fastify.log.error({ error }, 'Failed to create print quote')

      // Determine if it's a validation error or server error
      if (error.message.includes('No line items') || 
          error.message.includes('Draft order creation failed')) {
        reply.code(400)
        return {
          status: 'error',
          url: null,
          error: error.message
        }
      }

      // Server error
      reply.code(500)
      return {
        status: 'error',
        url: null,
        error: error.message
      }
    }
  })

  // POST /print-quote/from-draft - Generate VAT Invoice PDF from existing draft order
  fastify.post('/from-draft', {
    schema: {
      description: 'Generate a VAT Invoice PDF from an existing draft order. Fetches draft order data, ' +
                   'generates the PDF, uploads it to Shopify CDN, and attaches it to the draft order. ' +
                   'Returns when PDF URL is ready.',
      tags: ['print-quote'],
      body: {
        type: 'object',
        required: ['draftOrderId'],
        properties: {
          draftOrderId: { 
            type: 'string',
            description: 'Shopify draft order GID (e.g., gid://shopify/DraftOrder/123456789)'
          }
        }
      },
      response: {
        201: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            url: { type: ['string', 'null'] }
          }
        },
        400: {
          type: 'object',
          required: ['status', 'url'],
          properties: {
            status: { type: 'string' },
            url: { type: 'null' },
            error: { type: 'string' }
          }
        },
        500: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            url: { type: 'null' },
            error: { type: 'string' }
          }
        }
      }
    }
  }, async function (request, reply) {
    try {
      // Check if services are available
      if (!fastify.services || !fastify.services.draftOrder || !fastify.services.invoicePdf) {
        reply.code(500)
        return {
          status: 'error',
          url: null,
          error: 'Shopify services not configured'
        }
      }

      const { draftOrderId } = request.body

      // Log the incoming request
      fastify.log.info({
        draftOrderId
      }, 'Generating PDF for existing draft order')

      // Step 1: Fetch draft order from Shopify
      const draftOrder = await fastify.services.draftOrder.fetchDraftOrderById(draftOrderId)

      // Step 2: Generate and attach PDF using shared service
      const result = await fastify.services.invoicePdf.generateAndAttachPdf(draftOrder, null)

      // Return response
      reply.code(201)
      return result

    } catch (error) {
      fastify.log.error({ error }, 'Failed to generate PDF from draft order')

      // Determine if it's a validation error or server error
      if (error.message.includes('not found') || 
          error.message.includes('Draft order')) {
        reply.code(400)
        return {
          status: 'error',
          url: null,
          error: error.message
        }
      }

      // Server error
      reply.code(500)
      return {
        status: 'error',
        url: null,
        error: error.message
      }
    }
  })

  // GET /print-quote/health - Health check endpoint
  fastify.get('/health', {
    schema: {
      description: 'Health check endpoint for print quote service',
      tags: ['print-quote'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            service: { type: 'string' },
            pdfGeneration: { type: 'string' },
            timestamp: { type: 'string' }
          }
        }
      }
    }
  }, async function (request, reply) {
    const pdfEnabled = !!(fastify.services && fastify.services.pdf && fastify.services.shopifyFile)
    
    return {
      status: 'ok',
      service: 'print-quote',
      pdfGeneration: pdfEnabled ? 'enabled' : 'not_configured',
      shopifyUpload: pdfEnabled ? 'enabled' : 'not_configured',
      timestamp: new Date().toISOString()
    }
  })
}

