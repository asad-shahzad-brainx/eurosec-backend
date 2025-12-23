'use strict'

const fp = require('fastify-plugin')
const DraftOrderService = require('../services/draftOrder.service')
const CartService = require('../services/cart.service')
const PdfService = require('../services/pdf.service')
const ShopifyFileService = require('../services/shopifyFile.service')
const InvoicePdfService = require('../services/invoicePdf.service')

/**
 * Services Plugin
 * Registers business logic services
 */
module.exports = fp(async function (fastify, opts) {
  // Ensure required plugins are loaded
  if (!fastify.shopify) {
    // If shopify plugin not loaded, services will be unavailable
    // This is expected in test environments without credentials
    fastify.log.warn('Shopify plugin not loaded, services will be limited')
    
    // Decorate with null services so app can still start
    fastify.decorate('services', {
      draftOrder: null,
      cart: null,
      pdf: null,
      shopifyFile: null,
      invoicePdf: null
    })
    return
  }

  // Initialize services
  const pdfService = new PdfService(fastify)
  
  const services = {
    draftOrder: new DraftOrderService(fastify),
    cart: new CartService(fastify),
    pdf: pdfService,
    shopifyFile: new ShopifyFileService(fastify),
    invoicePdf: new InvoicePdfService(fastify)
  }

  // Decorate fastify with services
  fastify.decorate('services', services)

  fastify.log.info('Business services initialized')

  // Cleanup on server close
  fastify.addHook('onClose', async (instance) => {
    // Close Puppeteer browser if running
    if (pdfService && pdfService.browser) {
      await pdfService.closeBrowser()
    }
  })
}, {
  dependencies: ['config', 'shopify']
})

