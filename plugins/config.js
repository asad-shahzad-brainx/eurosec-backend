'use strict'

const fp = require('fastify-plugin')
require('dotenv').config()

/**
 * Configuration Plugin
 * Loads and validates environment variables
 */
module.exports = fp(async function (fastify, opts) {
  // Load configuration from environment variables
  const config = {
    env: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3000,
    shopify: {
      shopDomain: process.env.SHOPIFY_SHOP_DOMAIN,
      accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
      storefrontAccessToken: process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN,
      apiVersion: process.env.SHOPIFY_API_VERSION || '2025-10'
    },
    merchant: {
      vatId: process.env.MERCHANT_VAT_ID || '',
      companyName: process.env.MERCHANT_COMPANY_NAME || '',
      address1: process.env.MERCHANT_ADDRESS1 || '',
      address2: process.env.MERCHANT_ADDRESS2 || '',
      zip: process.env.MERCHANT_ZIP || '',
      city: process.env.MERCHANT_CITY || '',
      country: process.env.MERCHANT_COUNTRY || '',
      email: process.env.MERCHANT_EMAIL || '',
      phone: process.env.MERCHANT_PHONE || ''
    },
    // Invoice settings (fetched from shop metafields, env var as fallback)
    invoice: {
      prefix: process.env.INVOICE_PREFIX || 'INV-EE-'
    },
    // Shop data will be populated from Shopify API
    shop: null
  }

  // Validate required configuration in production
  if (config.env === 'production') {
    const required = [
      'SHOPIFY_SHOP_DOMAIN',
      'SHOPIFY_ACCESS_TOKEN',
      'SHOPIFY_STOREFRONT_ACCESS_TOKEN'
    ]

    for (const key of required) {
      if (!process.env[key]) {
        throw new Error(`${key} must be set in production`)
      }
    }
  }

  // Log configuration status (without sensitive data)
  fastify.log.info({
    env: config.env,
    port: config.port,
    shopDomain: config.shopify.shopDomain,
    apiVersion: config.shopify.apiVersion,
    hasAccessToken: !!config.shopify.accessToken,
    hasStorefrontToken: !!config.shopify.storefrontAccessToken
  }, 'Configuration loaded')

  // Decorate fastify instance with config
  fastify.decorate('config', config)

  // After app is ready, fetch shop data from Shopify and merge with config
  fastify.addHook('onReady', async function () {
    try {
      // Only fetch if Shopify client is available
      if (fastify.shopify && fastify.shopify.fetchShopData) {
        const shopData = await fastify.shopify.fetchShopData()
        
        // Store shop data
        config.shop = shopData
        
        // Merge shop data with merchant config (shop data and metafields take precedence)
        config.merchant = {
          ...config.merchant,
          companyName: shopData.billingAddress?.company || shopData.name || config.merchant.companyName || '',
          address1: shopData.billingAddress?.address1 || config.merchant.address1 || '',
          address2: shopData.billingAddress?.address2 || config.merchant.address2 || '',
          city: shopData.billingAddress?.city || config.merchant.city || '',
          zip: shopData.billingAddress?.zip || config.merchant.zip || '',
          country: shopData.billingAddress?.country || config.merchant.country || '',
          email: shopData.contactEmail || shopData.email || config.merchant.email || '',
          phone: shopData.billingAddress?.phone || config.merchant.phone || '',
          // VAT ID from shop metafield, with env var fallback
          vatId: shopData.vatId?.value || config.merchant.vatId || ''
        }

        // Invoice prefix from shop metafield, with env var fallback
        config.invoice = {
          ...config.invoice,
          prefix: shopData.invoicePrefix?.value || config.invoice.prefix || 'INV-EE-'
        }

        // Warn if VAT ID is not set (required for invoices)
        if (!config.merchant.vatId) {
          fastify.log.warn('Merchant VAT ID is not set (neither in shop metafield custom.vat_id nor MERCHANT_VAT_ID env var) - invoices will be generated without VAT ID')
        }

        // Warn about missing critical merchant information
        const missingFields = []
        if (!config.merchant.companyName) missingFields.push('companyName')
        if (!config.merchant.email) missingFields.push('email')
        if (!config.merchant.address1) missingFields.push('address1')
        if (!config.merchant.city) missingFields.push('city')
        if (!config.merchant.country) missingFields.push('country')

        if (missingFields.length > 0) {
          fastify.log.warn({
            missingFields
          }, 'Some merchant information is missing from shop data - invoices may have incomplete information')
        }

        fastify.log.info({
          companyName: config.merchant.companyName || '(empty)',
          email: config.merchant.email || '(empty)',
          vatId: config.merchant.vatId || '',
          invoicePrefix: config.invoice.prefix,
          currency: shopData.currencyCode,
          hasMissingFields: missingFields.length > 0
        }, 'Merchant configuration updated with shop data and metafields')
      }
    } catch (error) {
      // Log error but don't fail startup - use fallback values
      fastify.log.warn({ error }, 'Failed to fetch shop data, using fallback merchant configuration')
    }
  })
}, {
  name: 'config'
})

