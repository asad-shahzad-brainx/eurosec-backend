'use strict'

/**
 * Draft Order Service
 * Handles draft order creation using Shopify Admin API
 */
class DraftOrderService {
  constructor(fastify) {
    this.fastify = fastify
    this.adminClient = fastify.shopify.admin
    this.cartService = null // Will be set after services are initialized
  }

  /**
   * Process checkout data and create a draft order
   * @param {Object} payload - The checkout payload
   * @returns {Promise<Object>} Created draft order
   */
  async processCheckoutData(payload) {
    this.fastify.log.info('Processing checkout data')

    // Lazy load cart service to avoid circular dependency
    if (!this.cartService) {
      this.cartService = this.fastify.services.cart
    }

    let cartData = payload

    // If cartToken is provided, fetch latest cart data
    if (payload.cartToken) {
      this.fastify.log.info({ cartToken: payload.cartToken }, 'Cart token provided, fetching cart data')
      
      try {
        const cart = await this.cartService.fetchCartByToken(payload.cartToken)
        
        if (cart) {
          // Transform cart data and merge with payload
          const transformedCart = this.cartService.transformCartToPayload(cart)
          
          // Use cart data as primary source, fallback to payload
          cartData = {
            ...payload,
            cartLines: transformedCart.cartLines,
            customer: transformedCart.customer.email ? transformedCart.customer : payload.customer,
            pricing: transformedCart.pricing,
            shippingAddress: this.mergeAddress(transformedCart.shippingAddress, payload.shippingAddress),
            billingAddress: payload.billingAddress || transformedCart.shippingAddress,
            note: transformedCart.note || payload.note
          }
          
          this.fastify.log.info('Using cart data from Storefront API')
        } else {
          this.fastify.log.warn('Cart not found, using payload data')
        }
      } catch (error) {
        this.fastify.log.warn({ error }, 'Failed to fetch cart, falling back to payload data')
      }
    } else {
      this.fastify.log.info('No cart token provided, using payload data')
    }

    // Create draft order
    return await this.createDraftOrder(cartData)
  }

  /**
   * Merge address data, preferring non-empty values
   * @param {Object} primary - Primary address
   * @param {Object} fallback - Fallback address
   * @returns {Object} Merged address
   */
  mergeAddress(primary, fallback = {}) {
    return {
      firstName: primary.firstName || fallback.firstName || '',
      lastName: primary.lastName || fallback.lastName || '',
      address1: primary.address1 || fallback.address1 || '',
      address2: primary.address2 || fallback.address2 || '',
      city: primary.city || fallback.city || '',
      province: primary.province || fallback.province || '',
      provinceCode: primary.provinceCode || fallback.provinceCode || '',
      country: primary.country || fallback.country || '',
      countryCode: primary.countryCode || fallback.countryCode || '',
      zip: primary.zip || fallback.zip || '',
      phone: primary.phone || fallback.phone || '',
      company: primary.company || fallback.company || ''
    }
  }

  /**
   * Create a draft order in Shopify
   * @param {Object} data - Checkout data
   * @returns {Promise<Object>} Created draft order
   */
  async createDraftOrder(data) {
    if (!this.adminClient) {
      throw new Error('Admin API client not configured')
    }

    // Validate required data
    if (!data.cartLines || data.cartLines.length === 0) {
      throw new Error('No line items provided')
    }

    this.fastify.log.info({ lineItemsCount: data.cartLines.length }, 'Creating draft order')

    // Build line items for draft order
    const lineItems = data.cartLines.map(line => {
      const lineItem = {
        variantId: line.variantId,
        quantity: line.quantity
      }

      // Add custom attributes if present
      if (line.properties && line.properties.length > 0) {
        lineItem.customAttributes = line.properties.map(prop => ({
          key: prop.key,
          value: prop.value
        }))
      }

      return lineItem
    })

    // Build draft order input
    const input = {
      lineItems
    }

    // Add customer email if available
    if (data.customer?.email) {
      input.email = data.customer.email
    }

    // Add purchasing entity for B2B orders
    this.fastify.log.info({ data }, 'Processing checkout data')
    if (data.purchasingEntity?.company?.id && data.purchasingEntity?.location?.id) {
       let companyContactId = data.customer?.id

       // Try to fetch specific company contact ID if customer ID is available
       if (data.customer?.id) {
         const fetchedContactId = await this.fetchCompanyContactId(data.customer.id, data.purchasingEntity.company.id)
         if (fetchedContactId) {
           companyContactId = fetchedContactId
         }
       }

      input.purchasingEntity = {
        purchasingCompany: {
          companyId: data.purchasingEntity.company.id,
          companyLocationId: data.purchasingEntity.location.id,
          companyContactId: companyContactId
        }
      }
    }

    // Add shipping address if available
    if (data.shippingAddress && this.hasAddressData(data.shippingAddress)) {
      input.shippingAddress = this.buildShopifyAddress(data.shippingAddress)
    }

    // Add billing address if available
    if (data.billingAddress && this.hasAddressData(data.billingAddress)) {
      input.billingAddress = this.buildShopifyAddress(data.billingAddress)
    }

    // Add note if available
    if (data.note) {
      input.note = data.note
    }

    // Add tags to identify the source
    input.tags = ['quote-request']
    if (data.cartToken) {
      input.tags.push('cart-api')
    }

    // GraphQL mutation to create draft order
    const mutation = `
      mutation draftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder {
            id
            name
            status
            invoiceUrl
            createdAt
            updatedAt
            totalPrice
            subtotalPrice
            totalTax
            currencyCode
            taxLines {
              title
              rate
              price
            }
            shippingLine {
              title
              price
              taxLines {
                title
                rate
                price
              }
            }
            customer {
              id
              email
              firstName
              lastName
            }
            shippingAddress {
              firstName
              lastName
              address1
              address2
              city
              province
              country
              zip
              phone
            }
            billingAddress {
              firstName
              lastName
              address1
              address2
              city
              province
              country
              zip
              phone
            }
            lineItems(first: 100) {
              edges {
                node {
                  id
                  title
                  quantity
                  originalUnitPrice
                  taxLines {
                    title
                    rate
                    price
                  }
                  variant {
                    id
                    title
                    sku
                  }
                }
              }
            }
            purchasingEntity {
              ... on PurchasingCompany {
                company {
                  name
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    try {
      console.log("input", input);
      const response = await this.adminClient.request(mutation, {
        variables: { input }
      })

      if (response.data?.draftOrderCreate?.userErrors?.length > 0) {
        const errors = response.data.draftOrderCreate.userErrors
        this.fastify.log.error({ errors }, 'Draft order creation failed with user errors')
        throw new Error(`Draft order creation failed: ${errors.map(e => e.message).join(', ')}`)
      }

      const draftOrder = response.data?.draftOrderCreate?.draftOrder
      
      if (!draftOrder) {
        throw new Error('Draft order creation failed: No draft order returned')
      }

      this.fastify.log.info({ 
        draftOrderId: draftOrder.id,
        draftOrderName: draftOrder.name 
      }, 'Draft order created successfully')

      return this.formatDraftOrderResponse(draftOrder)
    } catch (error) {
      this.fastify.log.error({ error }, 'Failed to create draft order')
      throw new Error(`Failed to create draft order: ${error.message}`)
    }
  }

  /**
   * Check if address has any data
   * @param {Object} address - Address object
   * @returns {boolean} True if address has data
   */
  hasAddressData(address) {
    return !!(address.address1 || address.city || address.country || address.countryCode)
  }

  /**
   * Build Shopify address format
   * @param {Object} address - Address data
   * @returns {Object} Shopify formatted address
   */
  buildShopifyAddress(address) {
    const shopifyAddress = {}

    if (address.firstName) shopifyAddress.firstName = address.firstName
    if (address.lastName) shopifyAddress.lastName = address.lastName
    if (address.company) shopifyAddress.company = address.company
    if (address.address1) shopifyAddress.address1 = address.address1
    if (address.address2) shopifyAddress.address2 = address.address2
    if (address.city) shopifyAddress.city = address.city
    if (address.province) shopifyAddress.province = address.province
    if (address.provinceCode) shopifyAddress.provinceCode = address.provinceCode
    if (address.country) shopifyAddress.country = address.country
    if (address.countryCode) shopifyAddress.countryCode = address.countryCode
    if (address.zip) shopifyAddress.zip = address.zip
    if (address.phone) shopifyAddress.phone = address.phone

    return shopifyAddress
  }

  /**
   * Fetch an existing draft order by ID from Shopify
   * @param {string} draftOrderId - Draft order GID (e.g., gid://shopify/DraftOrder/123)
   * @returns {Promise<Object>} Draft order data
   */
  async fetchDraftOrderById(draftOrderId) {
    if (!this.adminClient) {
      throw new Error('Admin API client not configured')
    }

    this.fastify.log.info({ draftOrderId }, 'Fetching draft order by ID')

    const query = `
      query draftOrder($id: ID!) {
        draftOrder(id: $id) {
          id
          name
          status
          invoiceUrl
          createdAt
          updatedAt
          totalPrice
          subtotalPrice
          totalTax
          currencyCode
          taxLines {
            title
            rate
            price
          }
          appliedDiscount {
            amountSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            description
            title
            value
            valueType
          }
          discountCodes
          totalDiscountsSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          shippingLine {
            title
            price
            taxLines {
              title
              rate
              price
            }
          }
          customer {
            id
            email
            firstName
            lastName
          }
          shippingAddress {
            firstName
            lastName
            address1
            address2
            city
            province
            country
            zip
            phone
          }
          billingAddress {
            firstName
            lastName
            address1
            address2
            city
            province
            country
            zip
            phone
          }
          lineItems(first: 100) {
            edges {
              node {
                id
                title
                quantity
                originalUnitPrice
                taxLines {
                  title
                  rate
                  price
                }
                variant {
                  id
                  title
                  sku
                }
              }
            }
          }
          purchasingEntity {
            ... on PurchasingCompany {
              company {
                name
              }
            }
          }
        }
      }
    `

    try {
      const response = await this.adminClient.request(query, {
        variables: { id: draftOrderId }
      })

      const draftOrder = response.data?.draftOrder

      if (!draftOrder) {
        throw new Error(`Draft order not found: ${draftOrderId}`)
      }

      this.fastify.log.info({
        draftOrderId: draftOrder.id,
        draftOrderName: draftOrder.name
      }, 'Draft order fetched successfully')

      return this.formatDraftOrderResponse(draftOrder)
    } catch (error) {
      this.fastify.log.error({ error, draftOrderId }, 'Failed to fetch draft order')
      throw new Error(`Failed to fetch draft order: ${error.message}`)
    }
  }

  /**
   * Send invoice email for a draft order
   * @param {string} draftOrderId - Draft order GID (e.g., gid://shopify/DraftOrder/123)
   * @param {Object} emailOptions - Optional email customization
   * @param {string} emailOptions.to - Email recipient
   * @param {string} emailOptions.from - Email sender
   * @param {string[]} emailOptions.bcc - BCC recipients
   * @param {string} emailOptions.subject - Email subject
   * @param {string} emailOptions.customMessage - Custom message in email
   * @returns {Promise<Object>} Updated draft order
   */
  async sendInvoice(draftOrderId, emailOptions = null) {
    if (!this.adminClient) {
      throw new Error('Admin API client not configured')
    }

    this.fastify.log.info({ draftOrderId, hasEmailOptions: !!emailOptions }, 'Sending draft order invoice')

    const mutation = `
      mutation draftOrderInvoiceSend($id: ID!, $email: EmailInput) {
        draftOrderInvoiceSend(id: $id, email: $email) {
          draftOrder {
            id
            name
            invoiceSentAt
            invoiceUrl
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    try {
      const variables = { id: draftOrderId }
      
      // Add email options if provided
      if (emailOptions) {
        const email = {}
        if (emailOptions.to) email.to = emailOptions.to
        if (emailOptions.from) email.from = emailOptions.from
        if (emailOptions.bcc && emailOptions.bcc.length > 0) email.bcc = emailOptions.bcc
        if (emailOptions.subject) email.subject = emailOptions.subject
        if (emailOptions.customMessage) email.customMessage = emailOptions.customMessage
        
        if (Object.keys(email).length > 0) {
          variables.email = email
        }
      }

      const response = await this.adminClient.request(mutation, { variables })

      if (response.data?.draftOrderInvoiceSend?.userErrors?.length > 0) {
        const errors = response.data.draftOrderInvoiceSend.userErrors
        this.fastify.log.error({ errors }, 'Draft order invoice send failed with user errors')
        throw new Error(`Failed to send invoice: ${errors.map(e => e.message).join(', ')}`)
      }

      const draftOrder = response.data?.draftOrderInvoiceSend?.draftOrder

      if (!draftOrder) {
        throw new Error('Failed to send invoice: No draft order returned')
      }

      this.fastify.log.info({
        draftOrderId: draftOrder.id,
        draftOrderName: draftOrder.name,
        invoiceSentAt: draftOrder.invoiceSentAt
      }, 'Draft order invoice sent successfully')

      return {
        id: draftOrder.id,
        name: draftOrder.name,
        invoiceSentAt: draftOrder.invoiceSentAt,
        invoiceUrl: draftOrder.invoiceUrl
      }
    } catch (error) {
      this.fastify.log.error({ error, draftOrderId }, 'Failed to send draft order invoice')
      throw new Error(`Failed to send invoice: ${error.message}`)
    }
  }

  /**
   * Format draft order response for API
   * @param {Object} draftOrder - Draft order from Shopify
   * @returns {Object} Formatted response
   */
  formatDraftOrderResponse(draftOrder) {
    return {
      id: draftOrder.id,
      name: draftOrder.name,
      status: draftOrder.status,
      invoiceUrl: draftOrder.invoiceUrl,
      totalPrice: draftOrder.totalPrice,
      subtotalPrice: draftOrder.subtotalPrice,
      totalTax: draftOrder.totalTax,
      currencyCode: draftOrder.currencyCode,
      taxLines: draftOrder.taxLines || [],
      appliedDiscount: draftOrder.appliedDiscount,
      discountCodes: draftOrder.discountCodes || [],
      totalDiscountsSet: draftOrder.totalDiscountsSet,
      shippingLine: draftOrder.shippingLine,
      createdAt: draftOrder.createdAt,
      updatedAt: draftOrder.updatedAt,
      customer: draftOrder.customer,
      shippingAddress: draftOrder.shippingAddress,
      billingAddress: draftOrder.billingAddress,
      lineItems: draftOrder.lineItems,
      company: draftOrder.purchasingEntity?.company || null
    }
  }
  /**
   * Fetch company contact ID for a customer and company
   * @param {string} customerId - Customer GID
   * @param {string} companyId - Company GID
   * @returns {Promise<string|null>} Company Contact ID
   */
  async fetchCompanyContactId(customerId, companyId) {
    if (!this.adminClient) return null

    const query = `
      query customerCompanyContacts($customerId: ID!) {
        customer(id: $customerId) {
          companyContactProfiles {
            id
            company {
              id
            }
          }
        }
      }
    `

    try {
      const response = await this.adminClient.request(query, {
        variables: { customerId }
      })

      const profiles = response.data?.customer?.companyContactProfiles || []
      console.log("profiles", profiles);
      const match = profiles.find(profile => profile.company?.id === companyId)

      return match ? match.id : null
    } catch (error) {
      this.fastify.log.warn({ error, customerId, companyId }, 'Failed to fetch company contact ID')
      return null
    }
  }
}

module.exports = DraftOrderService

