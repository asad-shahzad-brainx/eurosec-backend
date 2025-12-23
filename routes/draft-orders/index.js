'use strict'

/**
 * Draft Orders Routes
 * Endpoints for creating draft orders from checkout/cart data
 */
module.exports = async function (fastify, opts) {
  // Schema for the checkout payload
  const checkoutPayloadSchema = {
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

  // POST /draft-orders - Create a draft order from checkout data
  fastify.post('/', {
    schema: {
      description: 'Create a draft order from checkout/cart data. ' +
                   'If cartToken is provided, it will fetch the latest cart data from Storefront API. ' +
                   'Otherwise, it will use the data provided in the payload.',
      tags: ['draft-orders'],
      body: checkoutPayloadSchema,
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            draftOrder: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                status: { type: 'string' },
                invoiceUrl: { type: 'string' },
                totalPrice: { type: 'string' },
                subtotalPrice: { type: 'string' },
                totalTax: { type: 'string' },
                currencyCode: { type: 'string' },
                createdAt: { type: 'string' },
                customer: { type: 'object' },
                shippingAddress: { type: 'object' },
                lineItems: { type: 'object' }
              }
            },
            message: { type: 'string' }
          }
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' }
          }
        },
        500: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' }
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
          success: false,
          error: 'Shopify services not configured',
          message: 'Please configure Shopify API credentials'
        }
      }

      const payload = request.body

      // Log the incoming request
      fastify.log.info({
        checkoutToken: payload.checkoutToken,
        cartToken: payload.cartToken,
        lineItemsCount: payload.cartLines?.length,
        hasCustomer: !!payload.customer?.email
      }, 'Creating draft order from checkout data')

      // Process the checkout data and create draft order
      const draftOrder = await fastify.services.draftOrder.processCheckoutData(payload)

      // Return success response
      reply.code(201)
      return {
        success: true,
        draftOrder,
        message: 'Draft order created successfully'
      }
    } catch (error) {
      fastify.log.error({ error }, 'Failed to create draft order')

      // Determine if it's a validation error or server error
      if (error.message.includes('No line items') || 
          error.message.includes('Draft order creation failed')) {
        reply.code(400)
        return {
          success: false,
          error: error.message,
          message: 'Invalid request data'
        }
      }

      // Server error
      reply.code(500)
      return {
        success: false,
        error: error.message,
        message: 'Failed to create draft order'
      }
    }
  })

  // GET /draft-orders/health - Health check endpoint
  fastify.get('/health', {
    schema: {
      description: 'Health check endpoint for draft orders service',
      tags: ['draft-orders'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            service: { type: 'string' },
            timestamp: { type: 'string' }
          }
        }
      }
    }
  }, async function (request, reply) {
    return {
      status: 'ok',
      service: 'draft-orders',
      timestamp: new Date().toISOString()
    }
  })
}

