'use strict'

const fp = require('fastify-plugin')
const { createAdminApiClient } = require('@shopify/admin-api-client')
const { createStorefrontApiClient } = require('@shopify/storefront-api-client')

/**
 * Shopify API Clients Plugin
 * Initializes and decorates Fastify with Shopify API clients
 */
module.exports = fp(async function (fastify, opts) {
  // Ensure config plugin is loaded first
  if (!fastify.config) {
    fastify.log.warn('Config plugin not loaded, using defaults')
  }

  const { shopify } = fastify.config || { shopify: {} }

  // Validate required configuration
  if (!shopify || !shopify.shopDomain || !shopify.accessToken) {
    fastify.log.warn('Shopify Admin API credentials not configured')
  }

  if (!shopify || !shopify.storefrontAccessToken) {
    fastify.log.warn('Shopify Storefront API credentials not configured')
  }

  // Initialize Admin API Client
  const adminClient = shopify && shopify.shopDomain && shopify.accessToken
    ? createAdminApiClient({
        storeDomain: shopify.shopDomain,
        apiVersion: shopify.apiVersion || '2025-10',
        accessToken: shopify.accessToken
      })
    : null

  // Initialize Storefront API Client
  const storefrontClient = shopify && shopify.shopDomain && shopify.storefrontAccessToken
    ? createStorefrontApiClient({
        storeDomain: shopify.shopDomain,
        apiVersion: shopify.apiVersion || '2025-10',
        publicAccessToken: shopify.storefrontAccessToken
      })
    : null

  /**
   * Fetch shop data from Shopify Admin API
   * @returns {Promise<Object>} Shop data including name, email, address, currency
   */
  async function fetchShopData() {
    if (!adminClient) {
      throw new Error('Shopify Admin API client not configured')
    }

    const query = `
      query {
        shop {
          name
          email
          contactEmail
          currencyCode
          billingAddress {
            address1
            address2
            city
            province
            country
            zip
            phone
            company
          }
        }
      }
    `

    try {
      const response = await adminClient.request(query)
      
      if (!response.data?.shop) {
        throw new Error('Failed to fetch shop data')
      }

      const shop = response.data.shop
      
      fastify.log.info({
        shopName: shop.name,
        currency: shop.currencyCode
      }, 'Shop data fetched successfully')

      return shop
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch shop data from Shopify')
      throw new Error(`Failed to fetch shop data: ${error.message}`)
    }
  }

  // Decorate fastify with Shopify clients
  fastify.decorate('shopify', {
    admin: adminClient,
    storefront: storefrontClient,
    fetchShopData
  })

  fastify.log.info({
    hasAdminClient: !!adminClient,
    hasStorefrontClient: !!storefrontClient
  }, 'Shopify API clients initialized')
}, {
  name: 'shopify',
  dependencies: ['config']
})

