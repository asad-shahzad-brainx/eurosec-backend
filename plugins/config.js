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
    // Merchant/Company details for invoices
    // Note: Most fields will be populated from Shopify store data
    // VAT ID must be set via environment variable (not available in Shopify API)
    merchant: {
      vatId: process.env.MERCHANT_VAT_ID || '',
      // Optional fallback values (only used if Shopify fetch fails and env vars are set)
      companyName: process.env.MERCHANT_COMPANY_NAME || '',
      address1: process.env.MERCHANT_ADDRESS1 || '',
      address2: process.env.MERCHANT_ADDRESS2 || '',
      zip: process.env.MERCHANT_ZIP || '',
      city: process.env.MERCHANT_CITY || '',
      country: process.env.MERCHANT_COUNTRY || '',
      email: process.env.MERCHANT_EMAIL || '',
      phone: process.env.MERCHANT_PHONE || ''
    },
    // Invoice settings
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

  // Warn if VAT ID is not set (required for invoices)
  if (!config.merchant.vatId) {
    fastify.log.warn('MERCHANT_VAT_ID is not set - invoices will be generated without VAT ID')
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
        console.log("ShopData", shopData);
        
        // Store shop data
        config.shop = shopData
        
        // Merge shop data with merchant config (shop data takes precedence, use empty strings if not available)
        config.merchant = {
          ...config.merchant,
          companyName: shopData.billingAddress?.company || shopData.name || '',
          address1: shopData.billingAddress?.address1 || '',
          address2: shopData.billingAddress?.address2 || '',
          city: shopData.billingAddress?.city || '',
          zip: shopData.billingAddress?.zip || '',
          country: shopData.billingAddress?.country || '',
          email: shopData.contactEmail || shopData.email || '',
          phone: shopData.billingAddress?.phone || ''
          // vatId remains from environment variable (not available in API)
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
          currency: shopData.currencyCode,
          hasMissingFields: missingFields.length > 0
        }, 'Merchant configuration updated with shop data')
      }
    } catch (error) {
      // Log error but don't fail startup - use fallback values
      fastify.log.warn({ error }, 'Failed to fetch shop data, using fallback merchant configuration')
    }
  })
}, {
  name: 'config'
})

